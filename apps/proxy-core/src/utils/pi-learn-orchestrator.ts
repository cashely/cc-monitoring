// pi-learn-orchestrator: outline/refine/tag 三阶段 learn 流水线
// - outline: url 模式先由 crawl agent 在阶段内自己驱动渐进抓取（crawl_open/crawl_visit/
//   save_source）写 sources/，再由单次 outline session read_source + add_outline
//   写 outline.json + seed topic；file 模式直接把上传正文写 sources/
// - refine: 对 outline.items 逐项开新 refine session，写 chunks/chunk-NNN.md
// - tag: 单次 tag session，读 chunks 后调 add_topic 写富 tags
//
// "轮次" = 一次 assistant 交互（assistant message_start → message_end）；
// slug 由入口 URL / 文件名确定性生成。

import fs from 'node:fs'
import path from 'node:path'
import { dataDir } from './paths.js'
import { createPiSession } from './pi-runtime.js'
import { CrawlGuard } from './pi-crawl-tools.js'
import { slugFromUrl, slugFromLabel } from './web-crawler.js'
import { assertNoOldDirs, readTopicDetail, reconcileTopics, mergeTopics } from './pi-dedup.js'

export interface OutlineItem {
  id: string
  title: string
  oneLine: string
}

export interface LearnPipelineEvents {
  stageStart(stage: 'outline' | 'refine' | 'tag', totalItems?: number): void
  stageItemStart(index: number, total: number, title: string): void
  stageItemEnd(index: number, chunkId: string): void
  stageItemFailed(index: number, title: string, reason: string): void
  stageEnd(stage: 'outline' | 'refine' | 'tag'): void
  roundStart(roundIndex: number): void
  roundEnd(roundIndex: number): void
  textDelta(delta: string): void
  thinkingDelta(delta: string): void
  toolStart(e: { toolCallId: string; toolName: string; args: unknown }): void
  toolEnd(e: { toolCallId: string; toolName: string; isError: boolean; durationMs: number; result: string }): void
}

export interface RunLearnPipelineOptions {
  sourceType: 'url' | 'file'
  /** url 模式=入口 URL；file 模式=上传得到的 markdown 正文 */
  input: string
  /** file 模式文件名（生成 slug 用）；url 可省略 */
  label?: string
  port: number
  events: LearnPipelineEvents
  /** 注入式 docsDir（测试用）；默认 ~/.cc-monitoring/docs */
  docsDir?: string
}

// pi AgentSession 的最小鸭子类型接口（避免直接依赖 pi-coding-agent 类型）
interface SessionLike {
  sessionId: string
  subscribe(listener: (ev: any) => void): () => void
  prompt(text: string): Promise<void>
  waitForIdle(): Promise<void>
  abort(): Promise<void>
}

/** 全局轮次计数器：跨阶段单调递增（outline 内 crawl/outline session、refine、tag 共享） */
type RoundCounter = { index: number }

// 每阶段（含 S2 每个 item prompt）独立超时：5 分钟。
// 防止 pi session 在 stuck LLM 响应上无限挂起，导致 SSE 通道常开、前端永久转圈。
const STAGE_TIMEOUT_MS = 5 * 60 * 1000

/**
 * Promise.race 包一层超时。超时触发时调用 abortFn（session.abort()），
 * 然后 reject；正常 settle 时清掉 timer，避免泄漏。
 */
function withTimeout<T>(p: Promise<T>, ms: number, abortFn: () => Promise<void>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeoutP = new Promise<T>((_, reject) => {
    timer = setTimeout(() => {
      // 触发 abort，尽量让底层 fetch/pi session 提前收尾；reject 用明确错误
      abortFn().catch(() => {})
      reject(new Error(`stage 超时 ${ms}ms`))
    }, ms)
  })
  return Promise.race([
    p.finally(() => {
      if (timer) clearTimeout(timer)
    }),
    timeoutP,
  ])
}

interface RunPromptResult {
  /** 本 session 内是否成功调了 add_topic 且 tags 非空 */
  addTopicCalled: boolean
  /** 本 session 内 read_source 是否至少成功执行一次（用于 S2 原料读取判定） */
  readSourceOk: boolean
}

/**
 * 跑一次 prompt，透传 text/tool 事件到 events；resolve 当 prompt 自然结束。
 * 同时返回本 session 内关键工具调用的标志位（用于 S3 成功判定）。
 */
async function runPrompt(
  session: SessionLike,
  promptText: string,
  events: LearnPipelineEvents,
  roundCounter: RoundCounter,
): Promise<RunPromptResult> {
  const result: RunPromptResult = { addTopicCalled: false, readSourceOk: false }
  // Finding 1：tool_execution_start 时只记录「即将调 add_topic 且 tags 非空」，
  // 真正置位必须等 tool_execution_end 且 isError=false。否则工具执行失败（upsert
  // 抛错/非法 slug/JSON 写失败）时重试循环会误判成功。
  let pendingAddTopicWithTags = false
  // 当前轮次索引：message_start 时记录，message_end 透传同一个值
  let currentRound = 0
  // 轮次是否在途：pi abort 时在途 assistant message 不发 message_end，
  // finally 需据此补发 roundEnd，保证任何退出路径轮次闭合
  let roundOpen = false
  const unsub = session.subscribe((ev: any) => {
    try {
      if (ev.type === 'message_start' && ev.message?.role === 'assistant') {
        currentRound = roundCounter.index
        roundCounter.index += 1
        roundOpen = true
        events.roundStart(currentRound)
      } else if (ev.type === 'message_end' && ev.message?.role === 'assistant') {
        roundOpen = false
        events.roundEnd(currentRound)
      } else if (ev.type === 'message_update') {
        const ae = ev.assistantMessageEvent
        if (ae?.type === 'text_delta' && typeof ae.delta === 'string') {
          events.textDelta(ae.delta)
        } else if (ae?.type === 'thinking_delta' && typeof ae.delta === 'string') {
          events.thinkingDelta(ae.delta)
        }
      } else if (ev.type === 'tool_execution_start') {
        events.toolStart({
          toolCallId: ev.toolCallId,
          toolName: ev.toolName,
          args: ev.args,
        })
        if (ev.toolName === 'add_topic') {
          const tags = (ev.args as any)?.tags
          pendingAddTopicWithTags = Array.isArray(tags) && tags.length > 0
        }
      } else if (ev.type === 'tool_execution_end') {
        const resultText = Array.isArray(ev.result?.content)
          ? ev.result.content.map((c: any) => (c?.type === 'text' ? c.text : '')).join('\n')
          : ''
        if (ev.toolName === 'add_topic' && pendingAddTopicWithTags && !ev.isError) {
          result.addTopicCalled = true
        }
        if (ev.toolName === 'read_source' && !ev.isError) {
          result.readSourceOk = true
        }
        events.toolEnd({
          toolCallId: ev.toolCallId,
          toolName: ev.toolName,
          isError: !!ev.isError,
          durationMs: ev.durationMs ?? 0,
          result: resultText,
        })
      }
    } catch {
      // 事件转发失败不中断流水线
    }
  })
  try {
    // Finding 3：整个 prompt + waitForIdle 包 5 分钟超时；超时 abort 并抛错。
    await withTimeout(
      (async () => {
        await session.prompt(promptText)
        await session.waitForIdle()
      })(),
      STAGE_TIMEOUT_MS,
      () => session.abort(),
    )
  } finally {
    unsub()
    // 在途轮次补闭合（abort/超时/异常导致 message_end 缺失）；回调异常不外泄
    if (roundOpen) {
      try { events.roundEnd(currentRound) } catch { /* 忽略 */ }
    }
  }
  return result
}

// ============================================================
// 原料准备 + outline 阶段
// ============================================================

/** 重建 topic 目录：sources/（抓取/上传原料）+ chunks/（后续产物） */
function prepareTopicDir(docsDir: string, slug: string): void {
  const dir = path.join(docsDir, slug)
  fs.rmSync(dir, { recursive: true, force: true })
  fs.mkdirSync(path.join(dir, 'sources'), { recursive: true })
  fs.mkdirSync(path.join(dir, 'chunks'), { recursive: true })
}

/** 写一份原料到 <slug>/sources/source-NNN.md */
function writeSourceFile(docsDir: string, slug: string, index: number, url: string, text: string): void {
  const name = `source-${String(index + 1).padStart(3, '0')}.md`
  fs.writeFileSync(path.join(docsDir, slug, 'sources', name), `Source: ${url}\n\n${text}`, 'utf8')
}

/** 数 <slug>/sources 下 .md 文件数量；目录不存在按 0 */
function countSourceFiles(docsDir: string, slug: string): number {
  try {
    return fs.readdirSync(path.join(docsDir, slug, 'sources')).filter((f) => f.endsWith('.md')).length
  } catch {
    return 0
  }
}

async function runOutlineStage(
  opts: {
    sourceType: 'url' | 'file'
    input: string
    label?: string
    port: number
    docsDir: string
    slug: string
  },
  events: LearnPipelineEvents,
  roundCounter: RoundCounter,
): Promise<{ slug: string; items: OutlineItem[]; title: string }> {
  // 抓取必须在 stageStart 之后：crawl 的 round/tool 事件才能落进前端已建好的 outline 阶段
  events.stageStart('outline')
  let guard: CrawlGuard | null = null
  try {
    if (opts.sourceType === 'url') {
      // crawl agent 在阶段内自己驱动渐进抓取；0 页则全新 guard+session 重试 1 次
      guard = new CrawlGuard({ entryUrl: opts.input, docsDir: opts.docsDir, slug: opts.slug })
      let crawlSession = (await createPiSession({
        port: opts.port,
        mode: 'crawl',
        crawlGuard: guard,
      })) as unknown as SessionLike
      const crawlPrompt =
        `Entry URL: ${opts.input}\n` +
        `Topic slug: ${opts.slug}\n` +
        `Call crawl_open to start, save every useful page with save_source, then call crawl_finish.`
      await runPrompt(crawlSession, crawlPrompt, events, roundCounter)

      if (countSourceFiles(opts.docsDir, opts.slug) === 0) {
        // 替换前关闭旧 guard（close 容错），再全新 guard + session 重试一次
        await guard.close()
        guard = new CrawlGuard({ entryUrl: opts.input, docsDir: opts.docsDir, slug: opts.slug })
        crawlSession = (await createPiSession({
          port: opts.port,
          mode: 'crawl',
          crawlGuard: guard,
        })) as unknown as SessionLike
        await runPrompt(crawlSession, crawlPrompt, events, roundCounter)
        if (countSourceFiles(opts.docsDir, opts.slug) === 0) {
          throw new Error('crawl 未收集到页面')
        }
      }
    } else {
      writeSourceFile(opts.docsDir, opts.slug, 0, opts.label ?? 'uploaded-file', opts.input)
    }

    // crawl 完成后的 outline session（流程不变）
    const session = (await createPiSession({ port: opts.port, mode: 'outline' })) as unknown as SessionLike
    const prompt =
      `Topic slug: ${opts.slug}\n` +
      `Call read_source(${JSON.stringify(opts.slug)}) to read the prepared sources, then call add_outline with this EXACT slug (${JSON.stringify(opts.slug)}). ` +
      `Provide an appropriate title and the outline items.`
    await runPrompt(session, prompt, events, roundCounter)

    const outlinePath = path.join(opts.docsDir, opts.slug, 'outline.json')
    if (!fs.existsSync(outlinePath)) throw new Error('outline 未生成')
    const outline = JSON.parse(fs.readFileSync(outlinePath, 'utf8')) as { items: OutlineItem[] }
    // title 取 S1 seed 的 index.json（查重门需要候选标题）
    const seedIdx = JSON.parse(
      fs.readFileSync(path.join(opts.docsDir, opts.slug, 'index.json'), 'utf8'),
    ) as { title: string }
    return { slug: opts.slug, items: outline.items, title: seedIdx.title }
  } finally {
    // 兜底关闭当前 guard（crawl_finish 已关时 close 也安全）
    await guard?.close()
    events.stageEnd('outline')
  }
}

// ============================================================
// refine 阶段
// ============================================================
async function runRefineStage(
  opts: { port: number; docsDir: string },
  slug: string,
  items: OutlineItem[],
  events: LearnPipelineEvents,
  roundCounter: RoundCounter,
  /** chunk id 起始偏移：合并进已有主题时从目标现有 chunk 数后续号 */
  startOffset = 0,
): Promise<{ chunksWritten: number; itemsFailed: number }> {
  events.stageStart('refine', items.length)
  let chunksWritten = 0
  let itemsFailed = 0

  try {
    for (let i = 0; i < items.length; i++) {
      const item = items[i]
      const chunkId = `chunk-${String(startOffset + i + 1).padStart(3, '0')}`
      events.stageItemStart(i, items.length, item.title)

      try {
        const prompt =
          `主题 slug: ${slug}\n` +
          `概念: ${item.title}\n` +
          `说明: ${item.oneLine}\n` +
          `请读 source.md 相关段落，写 chunks/${chunkId}.md，然后调 add_chunk 带 tags`

        let ok = false
        let failReason = 'chunk 文件未生成'
        for (let attempt = 0; attempt < 2 && !ok; attempt++) {
          const session = (await createPiSession({ port: opts.port, mode: 'refine' })) as unknown as SessionLike
          const res = await runPrompt(session, prompt, events, roundCounter)
          if (!res.readSourceOk) {
            failReason = 'read_source 未成功读取'
            continue
          }
          const chunkPath = path.join(opts.docsDir, slug, 'chunks', `${chunkId}.md`)
          try {
            const stat = fs.statSync(chunkPath)
            if (stat.size > 0) ok = true
          } catch {
            // 不存在 → 重试
          }
        }

        // Finding 2：chunk 文件非空不等于 add_chunk 被调。校验 index.json.chunks
        // 里真的有这个 chunkId，否则文件是孤儿（tag 阶段从 index.json 读 chunk 列表会静默跳过）。
        if (ok) {
          let chunkRegistered = false
          try {
            const idxPath = path.join(opts.docsDir, slug, 'index.json')
            const idx = JSON.parse(fs.readFileSync(idxPath, 'utf8')) as {
              chunks?: Array<{ id: string }>
            }
            chunkRegistered = (idx.chunks ?? []).some((c) => c.id === chunkId)
          } catch {
            // index.json 读失败/JSON 坏 → 当作未注册
            chunkRegistered = false
          }
          if (!chunkRegistered) {
            ok = false
            failReason = 'add_chunk 未调用'
          }
        }

        if (ok) {
          chunksWritten++
          events.stageItemEnd(i, chunkId)
        } else {
          itemsFailed++
          events.stageItemFailed(i, item.title, failReason)
        }
      } catch (e: any) {
        // per-item 任意错误（createPiSession 失败、prompt 抛错等）→ 不中断整个 refine 阶段
        itemsFailed++
        events.stageItemFailed(i, item.title, e?.message || String(e))
      }
    }
  } finally {
    events.stageEnd('refine')
  }
  return { chunksWritten, itemsFailed }
}

// ============================================================
// tag 阶段
// ============================================================
async function runTagStage(
  opts: { port: number; docsDir: string },
  slug: string,
  events: LearnPipelineEvents,
  roundCounter: RoundCounter,
  /** 合并场景：查重门裁定的合并后 title/summary，要求 add_topic 设置为该精确值 */
  override?: { title: string; summary: string },
): Promise<void> {
  events.stageStart('tag')
  try {
    const topicIdxPath = path.join(opts.docsDir, slug, 'index.json')
    const topicIdx = JSON.parse(fs.readFileSync(topicIdxPath, 'utf8')) as {
      title: string
      summary: string
      chunks: Array<{ id: string; title: string; summary: string }>
    }
    // 合并后重跑 tag：title/summary 取 override 精确值；否则沿用现有值
    const title = override?.title ?? topicIdx.title
    const summary = override?.summary ?? topicIdx.summary
    const chunkListing = (topicIdx.chunks ?? [])
      .map((c) => `- ${c.id}: ${c.title} — ${c.summary}`)
      .join('\n')

    const prompt =
      `主题 slug: ${slug}\n` +
      `现有 title: ${title}\n` +
      `现有 summary: ${summary}\n` +
      `已有 chunks:\n${chunkListing}\n\n` +
      `请用 read_chunk 读 chunks 实际内容，为该主题生成 5 类富 tags（同义/上位/触发场景/易混淆/典型提问，共 10-20 个小写连字符），` +
      (override
        ? `然后调 add_topic({ slug, title, summary, tags }) 覆盖主题元数据。title/summary 必须使用上面给出的精确值，不要改动。`
        : `然后调 add_topic({ slug, title, summary, tags }) 覆盖主题元数据。title/summary 复用现有值，不要改。`)

    let tagged = false
    for (let attempt = 0; attempt < 2 && !tagged; attempt++) {
      const session = (await createPiSession({ port: opts.port, mode: 'tag' })) as unknown as SessionLike
      const res = await runPrompt(session, prompt, events, roundCounter)
      if (res.addTopicCalled) {
        tagged = true
        break
      }
    }

    if (!tagged) {
      throw new Error('add_topic 未调用')
    }
  } finally {
    events.stageEnd('tag')
  }
}

// ============================================================
// 主编排
// ============================================================
export async function runLearnPipeline(
  opts: RunLearnPipelineOptions,
): Promise<{ slug: string; chunksWritten: number; itemsFailed: number }> {
  const docsDir = opts.docsDir ?? path.join(dataDir, 'docs')
  const slug = opts.sourceType === 'url' ? slugFromUrl(opts.input) : slugFromLabel(opts.label ?? 'topic')

  // 阻断：存在未清理的 .old 旁挂目录时直接拒绝，必须在一切写入之前
  assertNoOldDirs(docsDir)
  prepareTopicDir(docsDir, slug)

  // 全局轮次计数器：所有 session 共享，轮次索引全流水线单调递增
  const roundCounter: RoundCounter = { index: 0 }

  const { items, title } = await runOutlineStage({ ...opts, docsDir, slug }, opts.events, roundCounter)

  // 门1：outline 后、refine 前，基于大纲条目查重（命中则只要需新增的条目）
  const r1 = await reconcileTopics({
    port: opts.port,
    docsDir,
    candidate: { slug, title, tags: [], items },
    wantItems: true,
  })
  if (r1.match) {
    const targetSlug = r1.targetSlug!
    // 先物理并入（返回目标现有 chunk 总数作为续号偏移），再只写新增条目，最后带 override 打 tag
    const off = mergeTopics(docsDir, slug, targetSlug)
    const refine = await runRefineStage(
      { port: opts.port, docsDir }, targetSlug, r1.itemsToAdd!, opts.events, roundCounter, off,
    )
    await runTagStage(
      { port: opts.port, docsDir }, targetSlug, opts.events, roundCounter,
      { title: r1.mergedTitle!, summary: r1.mergedSummary! },
    )
    return { slug: targetSlug, chunksWritten: refine.chunksWritten, itemsFailed: refine.itemsFailed }
  }

  // 门1 未命中：常规 refine（从头编号）+ 常规 tag
  const refine = await runRefineStage(
    { port: opts.port, docsDir }, slug, items, opts.events, roundCounter, 0,
  )
  await runTagStage({ port: opts.port, docsDir }, slug, opts.events, roundCounter)

  // 门2：tag 后基于富 tags 再查一次（不需要新增条目）
  const detail = await readTopicDetail(docsDir, slug)
  const r2 = await reconcileTopics({
    port: opts.port,
    docsDir,
    candidate: { slug, title, tags: detail?.tags ?? [], items: undefined },
    wantItems: false,
  })
  if (r2.match) {
    const targetSlug = r2.targetSlug!
    mergeTopics(docsDir, slug, targetSlug)
    await runTagStage(
      { port: opts.port, docsDir }, targetSlug, opts.events, roundCounter,
      { title: r2.mergedTitle!, summary: r2.mergedSummary! },
    )
    return { slug: targetSlug, chunksWritten: refine.chunksWritten, itemsFailed: refine.itemsFailed }
  }

  return { slug, chunksWritten: refine.chunksWritten, itemsFailed: refine.itemsFailed }
}

// pi-learn-orchestrator: S1/S2/S3 三阶段 learn 流水线
// - S1 outline: 单次 outline session，写 outline.json + seed topic
// - S2 refine: 对 outline.items 逐项开新 refine session，写 chunks/chunk-NNN.md
// - S3 tag: 单次 tag session，读 chunks 后调 add_topic 写富 tags
//
// slug 检测策略：S1 开始前 snapshot docsDir 下已有 outline.json 的 slug 集合，
// S1 结束后 diff 出新出现的 slug。比「扫最新 mtime」稳健（不受历史目录干扰），
// 比「解析 assistant 文本」可靠（文本返回非结构化），也不用改 pi-runtime。

import fs from 'node:fs'
import path from 'node:path'
import { dataDir } from './paths.js'
import { createPiSession } from './pi-runtime.js'

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
  textDelta(delta: string): void
  thinkingDelta(delta: string): void
  toolStart(e: { toolCallId: string; toolName: string; args: unknown }): void
  toolEnd(e: { toolCallId: string; toolName: string; isError: boolean; durationMs: number; result: string }): void
}

export interface RunLearnPipelineOptions {
  prompt: string
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

const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/

/** 列出 docsDir 下当前已有 outline.json 的 slug 集合 */
function snapshotOutlinedSlugs(docsDir: string): Set<string> {
  const out = new Set<string>()
  let entries: string[]
  try {
    entries = fs.readdirSync(docsDir)
  } catch {
    return out
  }
  for (const e of entries) {
    if (!SLUG_RE.test(e)) continue
    if (fs.existsSync(path.join(docsDir, e, 'outline.json'))) out.add(e)
  }
  return out
}

/** 跑一次 prompt，透传 text/tool 事件到 events；resolve 当 prompt 自然结束 */
async function runPrompt(session: SessionLike, promptText: string, events: LearnPipelineEvents): Promise<void> {
  const unsub = session.subscribe((ev: any) => {
    try {
      if (ev.type === 'message_update') {
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
      } else if (ev.type === 'tool_execution_end') {
        const resultText = Array.isArray(ev.result?.content)
          ? ev.result.content.map((c: any) => (c?.type === 'text' ? c.text : '')).join('\n')
          : ''
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
    await session.prompt(promptText)
    await session.waitForIdle()
  } finally {
    unsub()
  }
}

// ============================================================
// S1: outline 阶段
// ============================================================
async function runOutlineStage(
  opts: { prompt: string; port: number; docsDir: string },
  events: LearnPipelineEvents,
): Promise<{ slug: string; items: OutlineItem[] }> {
  events.stageStart('outline')
  const before = snapshotOutlinedSlugs(opts.docsDir)

  const session = (await createPiSession({ port: opts.port, mode: 'outline' })) as unknown as SessionLike
  await runPrompt(session, opts.prompt, events)

  const after = snapshotOutlinedSlugs(opts.docsDir)
  const newSlugs = [...after].filter((s) => !before.has(s))
  if (newSlugs.length === 0) {
    events.stageEnd('outline')
    throw new Error('outline 未生成')
  }
  // 理论上 S1 只该调一次 add_outline；多个时取最后一个
  const slug = newSlugs[newSlugs.length - 1]
  const outlinePath = path.join(opts.docsDir, slug, 'outline.json')
  const outline = JSON.parse(fs.readFileSync(outlinePath, 'utf8')) as { slug: string; items: OutlineItem[] }
  events.stageEnd('outline')
  return { slug, items: outline.items }
}

// ============================================================
// S2: refine 阶段
// ============================================================
async function runRefineStage(
  opts: { port: number; docsDir: string },
  slug: string,
  items: OutlineItem[],
  events: LearnPipelineEvents,
): Promise<{ chunksWritten: number; itemsFailed: number }> {
  events.stageStart('refine', items.length)
  let chunksWritten = 0
  let itemsFailed = 0

  for (let i = 0; i < items.length; i++) {
    const item = items[i]
    const chunkId = `chunk-${String(i + 1).padStart(3, '0')}`
    events.stageItemStart(i, items.length, item.title)

    const prompt =
      `主题 slug: ${slug}\n` +
      `概念: ${item.title}\n` +
      `说明: ${item.oneLine}\n` +
      `请读 source.md 相关段落，写 chunks/${chunkId}.md，然后调 add_chunk 带 tags`

    let ok = false
    for (let attempt = 0; attempt < 2 && !ok; attempt++) {
      const session = (await createPiSession({ port: opts.port, mode: 'refine' })) as unknown as SessionLike
      await runPrompt(session, prompt, events)
      const chunkPath = path.join(opts.docsDir, slug, 'chunks', `${chunkId}.md`)
      try {
        const stat = fs.statSync(chunkPath)
        if (stat.size > 0) ok = true
      } catch {
        // 不存在 → 重试
      }
    }

    if (ok) {
      chunksWritten++
      events.stageItemEnd(i, chunkId)
    } else {
      itemsFailed++
      events.stageItemFailed(i, item.title, 'chunk 文件未生成')
    }
  }

  events.stageEnd('refine')
  return { chunksWritten, itemsFailed }
}

// ============================================================
// S3: tag 阶段
// ============================================================
async function runTagStage(
  opts: { port: number; docsDir: string },
  slug: string,
  events: LearnPipelineEvents,
): Promise<void> {
  events.stageStart('tag')

  const topicIdxPath = path.join(opts.docsDir, slug, 'index.json')
  const topicIdx = JSON.parse(fs.readFileSync(topicIdxPath, 'utf8')) as {
    title: string
    summary: string
    chunks: Array<{ id: string; title: string; summary: string }>
  }
  const chunkListing = (topicIdx.chunks ?? [])
    .map((c) => `- ${c.id}: ${c.title} — ${c.summary}`)
    .join('\n')

  const prompt =
    `主题 slug: ${slug}\n` +
    `现有 title: ${topicIdx.title}\n` +
    `现有 summary: ${topicIdx.summary}\n` +
    `已有 chunks:\n${chunkListing}\n\n` +
    `请用 read_chunk 读 chunks 实际内容，为该主题生成 5 类富 tags（同义/上位/触发场景/易混淆/典型提问，共 10-20 个小写连字符），` +
    `然后调 add_topic({ slug, title, summary, tags }) 覆盖主题元数据。title/summary 复用现有值，不要改。`

  let tagged = false
  for (let attempt = 0; attempt < 2 && !tagged; attempt++) {
    const session = (await createPiSession({ port: opts.port, mode: 'tag' })) as unknown as SessionLike
    await runPrompt(session, prompt, events)
    // 重新读 index.json：tags 非空说明 add_topic 真的被调了（S1 seed 时 tags=[]）
    try {
      const after = JSON.parse(fs.readFileSync(topicIdxPath, 'utf8')) as { tags?: string[] }
      if (Array.isArray(after.tags) && after.tags.length > 0) tagged = true
    } catch {
      // 重新读失败 → 不算 tagged，进入重试
    }
  }

  if (!tagged) {
    events.stageEnd('tag')
    throw new Error('add_topic 未调用')
  }
  events.stageEnd('tag')
}

// ============================================================
// 主编排
// ============================================================
export async function runLearnPipeline(
  opts: RunLearnPipelineOptions,
): Promise<{ slug: string; chunksWritten: number; itemsFailed: number }> {
  const docsDir = opts.docsDir ?? path.join(dataDir, 'docs')
  const common = { port: opts.port, docsDir }

  const { slug, items } = await runOutlineStage({ prompt: opts.prompt, ...common }, opts.events)
  const refine = await runRefineStage(common, slug, items, opts.events)
  await runTagStage(common, slug, opts.events)

  return { slug, chunksWritten: refine.chunksWritten, itemsFailed: refine.itemsFailed }
}

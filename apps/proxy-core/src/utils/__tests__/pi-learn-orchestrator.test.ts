import { promises as fsp } from 'node:fs'
import path from 'node:path'
import os from 'node:os'

// Mock pi-runtime: 每个测试通过 mockImplementationOnce 控制 createPiSession 的返回
jest.mock('../pi-runtime.js', () => ({
  createPiSession: jest.fn(),
}))

// Mock pi-dedup：只 mock 阻断 + LLM 裁定 + mintSlug；其余（mergeTopics/readAllTopics 等）保留真实实现
jest.mock('../pi-dedup.js', () => {
  const actual = jest.requireActual('../pi-dedup.js')
  return {
    ...actual,
    assertNoOldDirs: jest.fn(),
    reconcileTopics: jest.fn(async () => ({ match: false })),
    mintSlug: jest.fn(),
  }
})

// Mock pi-crawl-tools：url 模式的 CrawlGuard 替身（fixture graph，saveSource 落真实 tmpDir）。
// 图为闭包共享变量，用例通过 __setGraph 配置。
jest.mock('../pi-crawl-tools.js', () => {
  const fs = require('node:fs')
  const p = require('node:path')

  let graph: Record<string, { title: string; text: string; links: string[] }> = {}

  // 在构造函数 this 上初始化（jest mock.instances 才能拿到带状态的实例）
  const FakeCrawlGuard = jest.fn(function (this: any, gopts: { entryUrl: string; docsDir: string; slug: string }) {
    let saved = 0
    this.gopts = gopts
    this.closed = false
    this.open = async () => {
      const page = graph[gopts.entryUrl]
      if (!page) throw new Error(`fake guard fixture missing: ${gopts.entryUrl}`)
      return { url: gopts.entryUrl, ...page }
    }
    this.visit = async (url: string) => {
      const page = graph[url]
      if (!page) throw new Error(`fake guard fixture missing: ${url}`)
      return { url, ...page }
    }
    this.saveSource = (url: string): number => {
      const page = graph[url]
      if (!page) throw new Error(`fake guard save missing: ${url}`)
      const dir = p.join(gopts.docsDir, gopts.slug, 'sources')
      fs.mkdirSync(dir, { recursive: true })
      const name = `source-${String(saved + 1).padStart(3, '0')}.md`
      fs.writeFileSync(p.join(dir, name), `Source: ${url}\n\n${page.text}`, 'utf8')
      saved += 1
      return saved
    }
    this.close = async () => { this.closed = true }
  })

  return {
    CrawlGuard: FakeCrawlGuard,
    createCrawlTools: jest.fn(() => []),
    /** 测试用：替换 fixture graph（所有后续新建 guard 生效） */
    __setGraph: (g: typeof graph) => { graph = g },
  }
})

import { createPiSession } from '../pi-runtime.js'
import { reconcileTopics, assertNoOldDirs, mintSlug } from '../pi-dedup.js'
import { runLearnPipeline, type LearnPipelineEvents, type OutlineItem } from '../pi-learn-orchestrator.js'
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
const crawlToolsMock: {
  CrawlGuard: jest.Mock
  __setGraph: (g: Record<string, { title: string; text: string; links: string[] }>) => void
} = require('../pi-crawl-tools.js')

const mockCreatePiSession = createPiSession as jest.MockedFunction<typeof createPiSession>
const mockReconcile = reconcileTopics as jest.MockedFunction<typeof reconcileTopics>
const mockAssertNoOld = assertNoOldDirs as jest.MockedFunction<typeof assertNoOldDirs>
const mockMintSlug = mintSlug as jest.MockedFunction<typeof mintSlug>

// ---------- Fake session ----------
type SessionHandler = (prompt: string) => Promise<void>

class FakeSession {
  sessionId = `fake-${Math.random().toString(36).slice(2)}`
  private listeners = new Set<(ev: any) => void>()
  constructor(private readonly handler: SessionHandler) {}
  subscribe(fn: (ev: any) => void): () => void {
    this.listeners.add(fn)
    return () => { this.listeners.delete(fn) }
  }
  async prompt(text: string): Promise<void> {
    // "轮次" = 一次 assistant 交互（message_start → message_end）
    this.emit({ type: 'message_start', message: { role: 'assistant' } })
    await this.handler(text)
    this.emit({ type: 'message_end', message: { role: 'assistant' } })
    this.emit({ type: 'agent_end', messages: [], willRetry: false })
  }
  async waitForIdle(): Promise<void> {}
  async abort(): Promise<void> {}
  emit(ev: any): void {
    for (const l of this.listeners) l(ev)
  }
  /** 返回一个 handler：模拟 LLM 调了一次 add_topic（在 prompt 内 emit，确保 subscribe 后能收到） */
  static addTopicHandler(tags: string[]): SessionHandler {
    return async function (this: FakeSession) {
      this.emit({
        type: 'tool_execution_start',
        toolCallId: 'call-1',
        toolName: 'add_topic',
        args: { slug: 'x', title: 't', summary: 's', tags },
      })
      // Finding 1：成功判定 deferred 到 tool_execution_end 且 isError=false
      this.emit({
        type: 'tool_execution_end',
        toolCallId: 'call-1',
        toolName: 'add_topic',
        isError: false,
        durationMs: 12,
        result: { content: [{ type: 'text', text: 'ok' }] },
      })
    }
  }

  /** 包装一个 S2 handler：先 emit read_source 成功（S2 readSourceOk 判定），再跑 inner */
  static readSourceThen(inner: SessionHandler): SessionHandler {
    return async function (this: FakeSession, prompt: string) {
      this.emit({
        type: 'tool_execution_start',
        toolCallId: 'read-1',
        toolName: 'read_source',
        args: { topic: 'x' },
      })
      this.emit({
        type: 'tool_execution_end',
        toolCallId: 'read-1',
        toolName: 'read_source',
        isError: false,
        durationMs: 3,
        result: { content: [{ type: 'text', text: 'sources' }] },
      })
      await inner.call(this, prompt)
    }
  }

  /** add_topic 带非空 tags 但工具执行失败（upsert 抛错等） → orchestrator 必须重试 */
  static addTopicErrorHandler(tags: string[]): SessionHandler {
    return async function (this: FakeSession) {
      this.emit({
        type: 'tool_execution_start',
        toolCallId: 'call-1',
        toolName: 'add_topic',
        args: { slug: 'x', title: 't', summary: 's', tags },
      })
      this.emit({
        type: 'tool_execution_end',
        toolCallId: 'call-1',
        toolName: 'add_topic',
        isError: true,
        durationMs: 5,
        result: { content: [{ type: 'text', text: 'upsertTopic failed: invalid slug' }] },
      })
    }
  }
}

function makeEvents(): LearnPipelineEvents & { calls: string[] } {
  const calls: string[] = []
  const ev = {
    calls,
    stageStart: (stage: string, totalItems?: number) =>
      calls.push(`stageStart:${stage}${totalItems !== undefined ? ':' + totalItems : ''}`),
    stageItemStart: (i: number, _t: number, title: string) => calls.push(`stageItemStart:${i}:${title}`),
    stageItemEnd: (i: number, chunkId: string) => calls.push(`stageItemEnd:${i}:${chunkId}`),
    stageItemFailed: (i: number, _title: string, reason: string) =>
      calls.push(`stageItemFailed:${i}:${reason}`),
    stageEnd: (stage: string) => calls.push(`stageEnd:${stage}`),
    roundStart: (i: number) => calls.push(`roundStart:${i}`),
    roundEnd: (i: number) => calls.push(`roundEnd:${i}`),
    textDelta: () => {},
    thinkingDelta: () => {},
    toolStart: () => {},
    toolEnd: () => {},
  }
  return ev as unknown as LearnPipelineEvents & { calls: string[] }
}

// ---------- 默认 session 路由（url 用例用；Once / 显式 implementation 优先） ----------

/** crawl handler：open → save_source → 沿 links 逐页 visit + save_source */
function makeCrawlHandler(guard: any): SessionHandler {
  return async function (this: FakeSession) {
    const entry = await guard.open()
    guard.saveSource(entry.url)
    for (const link of entry.links ?? []) {
      const child = await guard.visit(link)
      guard.saveSource(child.url)
    }
  }
}

/** outline handler：从 prompt 解析 slug，写 outline.json + seed index.json（1 item） */
function defaultOutlineHandler(): SessionHandler {
  return async function (this: FakeSession, prompt: string) {
    const slug = prompt.match(/slug: ([^\s\n]+)/)![1]
    await fsp.mkdir(path.join(tmpDir, slug, 'chunks'), { recursive: true })
    const items = [{ id: 'a', title: '概念A', oneLine: 'aaa' }]
    await fsp.writeFile(
      path.join(tmpDir, slug, 'outline.json'),
      JSON.stringify({ slug, source: 'sources/', items }, null, 2),
    )
    await fsp.writeFile(
      path.join(tmpDir, slug, 'index.json'),
      JSON.stringify({ slug, title: 'Default', summary: '(refining)', tags: [], chunks: [
        { id: 'chunk-001', title: '概念A', summary: 'aaa', tags: [] },
      ] }, null, 2),
    )
  }
}

/** 门1 用 S1 handler：写 outline.json + seed index，chunks 必须为 []——
 * 否则真实 mergeTopics 会按 ref 去找不存在的 chunk 正文而抛错 */
function gate1OutlineHandler(slug: string, items: OutlineItem[]): SessionHandler {
  return async function (this: FakeSession) {
    await fsp.mkdir(path.join(tmpDir, slug, 'chunks'), { recursive: true })
    await fsp.writeFile(
      path.join(tmpDir, slug, 'outline.json'),
      JSON.stringify({ slug, source: 'sources/', items }, null, 2),
    )
    await fsp.writeFile(
      path.join(tmpDir, slug, 'index.json'),
      JSON.stringify({ slug, title: 'New', summary: '(refining)', tags: [], chunks: [] }, null, 2),
    )
  }
}

/** 预先铺一个已有主题 dstSlug（1 chunk）+ 根 index 注册 */
async function seedOldTopic(dstSlug: string): Promise<void> {
  await fsp.mkdir(path.join(tmpDir, dstSlug, 'chunks'), { recursive: true })
  await fsp.writeFile(
    path.join(tmpDir, dstSlug, 'index.json'),
    JSON.stringify({ slug: dstSlug, title: 'Old', summary: 'old summary', tags: [], chunks: [
      { id: 'chunk-001', title: 'T1', summary: 's1', tags: [] },
    ] }, null, 2),
  )
  await fsp.writeFile(path.join(tmpDir, dstSlug, 'chunks', 'chunk-001.md'), '# T1')
  await fsp.writeFile(
    path.join(tmpDir, 'index.json'),
    JSON.stringify({ topics: [
      { slug: dstSlug, title: 'Old', summary: 'old summary', tags: [] },
    ] }, null, 2),
  )
}

/** 门0 用 S1 handler（file 模式）：旧 topic 已旁挂，fresh dir 由 file 阶段自己写 sources；
 *  outline session 写 outline.json + seed index.json，chunks 必须为 []（镜像 gate1OutlineHandler） */
function gate0OutlineHandler(slug: string, items: OutlineItem[]): SessionHandler {
  return async function (this: FakeSession) {
    await fsp.mkdir(path.join(tmpDir, slug, 'chunks'), { recursive: true })
    await fsp.writeFile(
      path.join(tmpDir, slug, 'outline.json'),
      JSON.stringify({ slug, source: 'sources/', items }, null, 2),
    )
    await fsp.writeFile(
      path.join(tmpDir, slug, 'index.json'),
      JSON.stringify({ slug, title: 'New', summary: '(refining)', tags: [], chunks: [] }, null, 2),
    )
  }
}

/** 门0 用例：预铺 slug=dup 的旧主题（sources + 2 chunks + index + 根 index 登记） */
async function seedDupTopic(): Promise<void> {
  await fsp.mkdir(path.join(tmpDir, 'dup', 'chunks'), { recursive: true })
  await fsp.mkdir(path.join(tmpDir, 'dup', 'sources'), { recursive: true })
  await fsp.writeFile(
    path.join(tmpDir, 'dup', 'index.json'),
    JSON.stringify({ slug: 'dup', title: 'Old Dup', summary: 'old dup summary', tags: [], chunks: [
      { id: 'chunk-001', title: 'T1', summary: 's1', tags: [] },
      { id: 'chunk-002', title: 'T2', summary: 's2', tags: [] },
    ] }, null, 2),
  )
  await fsp.writeFile(path.join(tmpDir, 'dup', 'chunks', 'chunk-001.md'), 'OLD BODY 001\n')
  await fsp.writeFile(path.join(tmpDir, 'dup', 'chunks', 'chunk-002.md'), 'OLD BODY 002\n')
  await fsp.writeFile(path.join(tmpDir, 'dup', 'sources', 'source-001.md'), 'OLD SOURCE\n')
  await fsp.writeFile(
    path.join(tmpDir, 'index.json'),
    JSON.stringify({ topics: [
      { slug: 'dup', title: 'Old Dup', summary: 'old dup summary', tags: [] },
    ] }, null, 2),
  )
}

/** tag handler：先捕获 prompt 文本（断言 tag 对哪个 slug / 用了什么 title），再 emit add_topic */
function tagCaptureHandler(captured: string[]): SessionHandler {
  const add = FakeSession.addTopicHandler(['merged-tag'])
  return async function (this: FakeSession, prompt: string) {
    captured.push(prompt)
    await add.call(this, prompt)
  }
}

// ---------- Test scaffolding ----------
let tmpDir: string

beforeEach(async () => {
  tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'learn-pipe-'))
  mockCreatePiSession.mockReset()
  // 查重门 mock：默认两道门都不合并，保证现有用例行为不变
  mockReconcile.mockReset()
  mockReconcile.mockResolvedValue({ match: false })
  mockAssertNoOld.mockReset()
  mockAssertNoOld.mockImplementation(() => {})
  // mintSlug 默认另铸固定 slug；门0 碰撞用例可覆盖
  mockMintSlug.mockReset()
  mockMintSlug.mockResolvedValue('minted-slug')
  // CrawlGuard 的 mock 由 jest.mock 工厂创建，生命周期跨用例，需手动清调用记录
  crawlToolsMock.CrawlGuard.mockClear()
  // 默认按 mode 路由；具体用例的 mockImplementationOnce 优先
  mockCreatePiSession.mockImplementation(async (options) => {
    if (options.mode === 'crawl') {
      return new FakeSession(makeCrawlHandler((options as any).crawlGuard)) as any
    }
    if (options.mode === 'outline') {
      return new FakeSession(defaultOutlineHandler()) as any
    }
    if (options.mode === 'refine') {
      return new FakeSession(FakeSession.readSourceThen(async () => {
        const slug = 'pi'
        await fsp.writeFile(path.join(tmpDir, slug, 'chunks', 'chunk-001.md'), '# 概念A')
      })) as any
    }
    return new FakeSession(FakeSession.addTopicHandler(['tag-a', 'tag-b'])) as any
  })
})

afterEach(async () => {
  await fsp.rm(tmpDir, { recursive: true, force: true })
})

// ============================================================
describe('pi-learn-orchestrator', () => {
  test('S1 失败：session 从不写 outline.json → reject 含「outline 未生成」', async () => {
    mockCreatePiSession.mockImplementation(async () => {
      return new FakeSession(async () => {}) as any
    })

    await expect(
      runLearnPipeline({
        sourceType: 'file',
        input: '# body',
        label: 'my-topic.md',
        port: 9999,
        events: makeEvents(),
        docsDir: tmpDir,
      }),
    ).rejects.toThrow(/outline 未生成/)

    expect(mockCreatePiSession).toHaveBeenCalledTimes(1)
    expect(mockCreatePiSession.mock.calls[0][0].mode).toBe('outline')
  })

  test('S2 部分失败：3 items，第 2 个重试也失败 → chunksWritten=2, itemsFailed=1', async () => {
    const items = [
      { id: 'a', title: '概念A', oneLine: 'aaa' },
      { id: 'b', title: '概念B', oneLine: 'bbb' },
      { id: 'c', title: '概念C', oneLine: 'ccc' },
    ]
    const slug = 'my-topic'

    // S1 outline session: 写 outline.json + seed index.json（真实流程由 add_outline 工具做）。
    // 必须在 session handler 内做：pipeline 开头的 prepareTopicDir 会清空重建 topic 目录。
    mockCreatePiSession.mockImplementationOnce(async () => {
      return new FakeSession(async () => {
        await fsp.mkdir(path.join(tmpDir, slug, 'chunks'), { recursive: true })
        await fsp.writeFile(
          path.join(tmpDir, slug, 'outline.json'),
          JSON.stringify({ slug, source: 'sources/', items }, null, 2),
        )
        await fsp.writeFile(
          path.join(tmpDir, slug, 'index.json'),
          JSON.stringify({ slug, title: 'My Topic', summary: '(refining)', tags: [], chunks: [
            { id: 'chunk-001', title: '概念A', summary: 'aaa', tags: [] },
            { id: 'chunk-003', title: '概念C', summary: 'ccc', tags: [] },
          ] }, null, 2),
        )
      }) as any
    })

    // S2 调用序列：item0 try0 (写 chunk-001), item1 try0 (空), item1 try1 (空), item2 try0 (写 chunk-003)
    const writeChunk = async (i: number) => {
      await fsp.writeFile(
        path.join(tmpDir, slug, 'chunks', `chunk-00${i + 1}.md`),
        `# 概念${'ABC'[i]}`,
      )
    }
    mockCreatePiSession.mockImplementationOnce(async () => new FakeSession(FakeSession.readSourceThen(async () => { await writeChunk(0) })) as any)
    mockCreatePiSession.mockImplementationOnce(async () => new FakeSession(FakeSession.readSourceThen(async () => {})) as any)
    mockCreatePiSession.mockImplementationOnce(async () => new FakeSession(FakeSession.readSourceThen(async () => {})) as any)
    mockCreatePiSession.mockImplementationOnce(async () => new FakeSession(FakeSession.readSourceThen(async () => { await writeChunk(2) })) as any)

    // S3: 兜底 mock（mockImplementationOnce 已用完），handler 内 emit add_topic
    mockCreatePiSession.mockImplementation(async () => {
      return new FakeSession(FakeSession.addTopicHandler(['react', 'hooks'])) as any
    })

    const events = makeEvents()
    const result = await runLearnPipeline({
      sourceType: 'file',
      input: '# body',
      label: `${slug}.md`,
      port: 9999,
      events,
      docsDir: tmpDir,
    })

    expect(result.slug).toBe('my-topic')
    expect(result.chunksWritten).toBe(2)
    expect(result.itemsFailed).toBe(1)

    const failed = events.calls.filter((c) => c.startsWith('stageItemFailed:'))
    expect(failed).toHaveLength(1)
    expect(failed[0]).toContain('chunk 文件未生成')
    expect(failed[0]).toContain('stageItemFailed:1:')
  })

  test('S3 happy path：add_topic 被调用且 tags 非空 → stageEnd(tag)', async () => {
    const items = [{ id: 'a', title: '概念A', oneLine: 'aaa' }]
    const slug = 'happy-topic'

    // S1: session 写 outline.json，并 seed index.json + chunk（真实流程由 add_outline / add_chunk 工具写）
    mockCreatePiSession.mockImplementationOnce(async () => {
      return new FakeSession(async () => {
        await fsp.mkdir(path.join(tmpDir, slug, 'chunks'), { recursive: true })
        await fsp.writeFile(
          path.join(tmpDir, slug, 'outline.json'),
          JSON.stringify({ slug, source: 'sources/', items }, null, 2),
        )
        await fsp.writeFile(
          path.join(tmpDir, slug, 'index.json'),
          JSON.stringify({ slug, title: 'Happy', summary: '(refining)', tags: [], chunks: [
            { id: 'chunk-001', title: '概念A', summary: 'aaa', tags: [] },
          ] }, null, 2),
        )
        await fsp.writeFile(path.join(tmpDir, slug, 'chunks', 'chunk-001.md'), '# 概念A')
      }) as any
    })
    // S2 item0: chunk-001.md 已存在，session 仅 emit read_source 成功
    mockCreatePiSession.mockImplementationOnce(async () => new FakeSession(FakeSession.readSourceThen(async () => {})) as any)
    // S3: handler 内 emit add_topic 带非空 tags
    mockCreatePiSession.mockImplementationOnce(async () => {
      return new FakeSession(FakeSession.addTopicHandler(['synonym-a', 'hypernym-b'])) as any
    })

    const events = makeEvents()
    const result = await runLearnPipeline({
      sourceType: 'file',
      input: '# body',
      label: `${slug}.md`,
      port: 9999,
      events,
      docsDir: tmpDir,
    })

    expect(result.slug).toBe(slug)
    expect(events.calls).toContain('stageEnd:outline')
    expect(events.calls).toContain('stageEnd:refine')
    expect(events.calls).toContain('stageEnd:tag')
  })

  test('S1 outline.json parse 失败 → stageEnd(outline) 仍发出，再 throw', async () => {
    const slug = 'broken-topic'

    // S1 session 写一个非法 JSON 的 outline.json（prepareTopicDir 已先清空目录，故须在 handler 内写）
    mockCreatePiSession.mockImplementationOnce(async () => new FakeSession(async () => {
      await fsp.mkdir(path.join(tmpDir, slug, 'chunks'), { recursive: true })
      await fsp.writeFile(path.join(tmpDir, slug, 'outline.json'), '{not valid json', 'utf8')
    }) as any)

    const events = makeEvents()
    await expect(
      runLearnPipeline({
        sourceType: 'file',
        input: '# body',
        label: `${slug}.md`,
        port: 9999,
        events,
        docsDir: tmpDir,
      }),
    ).rejects.toThrow()

    // stageEnd 必须在 throw 之前发出
    expect(events.calls).toContain('stageEnd:outline')
  })

  test('S2 createPiSession 抛错 → stageItemFailed 发出，pipeline 继续', async () => {
    const items = [
      { id: 'a', title: '概念A', oneLine: 'aaa' },
      { id: 'b', title: '概念B', oneLine: 'bbb' },
    ]
    const slug = 'err-topic'

    // S1: 写 outline.json + seed index.json
    mockCreatePiSession.mockImplementationOnce(async () => {
      return new FakeSession(async () => {
        await fsp.mkdir(path.join(tmpDir, slug, 'chunks'), { recursive: true })
        await fsp.writeFile(
          path.join(tmpDir, slug, 'outline.json'),
          JSON.stringify({ slug, source: 'sources/', items }, null, 2),
        )
        await fsp.writeFile(
          path.join(tmpDir, slug, 'index.json'),
          JSON.stringify({ slug, title: 'Err', summary: '(refining)', tags: [], chunks: [
            { id: 'chunk-002', title: '概念B', summary: 'bbb', tags: [] },
          ] }, null, 2),
        )
      }) as any
    })
    // S2 item0: createPiSession 抛错（模拟 pi runtime 挂了）
    mockCreatePiSession.mockImplementationOnce(async () => {
      throw new Error('port down')
    })
    // S2 item1: 成功写 chunk-002.md
    mockCreatePiSession.mockImplementationOnce(async () => {
      return new FakeSession(FakeSession.readSourceThen(async () => {
        await fsp.writeFile(
          path.join(tmpDir, slug, 'chunks', 'chunk-002.md'),
          '# 概念B',
        )
      })) as any
    })
    // S3: handler 内 emit add_topic
    mockCreatePiSession.mockImplementation(async () => {
      return new FakeSession(FakeSession.addTopicHandler(['tag1'])) as any
    })

    const events = makeEvents()
    const result = await runLearnPipeline({
      sourceType: 'file',
      input: '# body',
      label: `${slug}.md`,
      port: 9999,
      events,
      docsDir: tmpDir,
    })

    // item0 失败（port down），item1 成功
    expect(result.itemsFailed).toBe(1)
    expect(result.chunksWritten).toBe(1)
    // stageItemFailed 必须发出，reason 含 port down
    const failed = events.calls.filter((c) => c.startsWith('stageItemFailed:'))
    expect(failed).toHaveLength(1)
    expect(failed[0]).toContain('port down')
    // stageEnd(refine) 必须发出
    expect(events.calls).toContain('stageEnd:refine')
  })

  test('S3 add_topic 带空 tags → 视为失败，重试一次；第二次非空 → 成功', async () => {
    const items = [{ id: 'a', title: '概念A', oneLine: 'aaa' }]
    const slug = 'retry-topic'

    // S1: 写 outline.json + seed index.json + chunk
    mockCreatePiSession.mockImplementationOnce(async () => {
      return new FakeSession(async () => {
        await fsp.mkdir(path.join(tmpDir, slug, 'chunks'), { recursive: true })
        await fsp.writeFile(
          path.join(tmpDir, slug, 'outline.json'),
          JSON.stringify({ slug, source: 'sources/', items }, null, 2),
        )
        await fsp.writeFile(
          path.join(tmpDir, slug, 'index.json'),
          JSON.stringify({ slug, title: 'Retry', summary: '(refining)', tags: [], chunks: [
            { id: 'chunk-001', title: '概念A', summary: 'aaa', tags: [] },
          ] }, null, 2),
        )
        await fsp.writeFile(path.join(tmpDir, slug, 'chunks', 'chunk-001.md'), '# A')
      }) as any
    })
    // S2 item0: chunk 已存在，仅 read_source 成功
    mockCreatePiSession.mockImplementationOnce(async () => new FakeSession(FakeSession.readSourceThen(async () => {})) as any)
    // S3 try0: add_topic 带空 tags → 不算成功
    mockCreatePiSession.mockImplementationOnce(async () => {
      return new FakeSession(FakeSession.addTopicHandler([])) as any
    })
    // S3 try1: add_topic 带非空 tags → 成功
    mockCreatePiSession.mockImplementationOnce(async () => {
      return new FakeSession(FakeSession.addTopicHandler(['real-tag'])) as any
    })

    const events = makeEvents()
    const result = await runLearnPipeline({
      sourceType: 'file',
      input: '# body',
      label: `${slug}.md`,
      port: 9999,
      events,
      docsDir: tmpDir,
    })

    expect(result.slug).toBe(slug)
    expect(events.calls).toContain('stageEnd:tag')
  })

  test('Finding 1：S3 add_topic tags 非空但 tool_execution_end isError=true → 不算成功，重试后成功', async () => {
    const items = [{ id: 'a', title: '概念A', oneLine: 'aaa' }]
    const slug = 'err-tag-topic'

    // S1: 写 outline.json + seed index.json + chunk
    mockCreatePiSession.mockImplementationOnce(async () => {
      return new FakeSession(async () => {
        await fsp.mkdir(path.join(tmpDir, slug, 'chunks'), { recursive: true })
        await fsp.writeFile(
          path.join(tmpDir, slug, 'outline.json'),
          JSON.stringify({ slug, source: 'sources/', items }, null, 2),
        )
        await fsp.writeFile(
          path.join(tmpDir, slug, 'index.json'),
          JSON.stringify({ slug, title: 'T', summary: '(refining)', tags: [], chunks: [
            { id: 'chunk-001', title: '概念A', summary: 'aaa', tags: [] },
          ] }, null, 2),
        )
        await fsp.writeFile(path.join(tmpDir, slug, 'chunks', 'chunk-001.md'), '# A')
      }) as any
    })
    // S2 item0: chunk 已存在，仅 read_source 成功
    mockCreatePiSession.mockImplementationOnce(async () => new FakeSession(FakeSession.readSourceThen(async () => {})) as any)
    // S3 try0: add_topic 带非空 tags 但工具执行失败 → 必须重试
    mockCreatePiSession.mockImplementationOnce(async () => {
      return new FakeSession(FakeSession.addTopicErrorHandler(['bad-tag'])) as any
    })
    // S3 try1: add_topic 成功
    mockCreatePiSession.mockImplementationOnce(async () => {
      return new FakeSession(FakeSession.addTopicHandler(['real-tag'])) as any
    })

    const events = makeEvents()
    const result = await runLearnPipeline({
      sourceType: 'file',
      input: '# body',
      label: `${slug}.md`,
      port: 9999,
      events,
      docsDir: tmpDir,
    })

    expect(result.slug).toBe(slug)
    expect(events.calls).toContain('stageEnd:tag')
    // S1(1) + S2(1) + S3 两次重试 = 4 次 session
    expect(mockCreatePiSession).toHaveBeenCalledTimes(4)
  })

  test('Finding 2：S2 item 写了 chunk-001.md 但从未调 add_chunk（index.json 无 chunkId）→ item 失败', async () => {
    const items = [{ id: 'a', title: '概念A', oneLine: 'aaa' }]
    const slug = 'orphan-topic'

    // S1: 写 outline.json + seed index.json（chunks 为空，模拟 add_chunk 没被调）
    mockCreatePiSession.mockImplementationOnce(async () => {
      return new FakeSession(async () => {
        await fsp.mkdir(path.join(tmpDir, slug, 'chunks'), { recursive: true })
        await fsp.writeFile(
          path.join(tmpDir, slug, 'outline.json'),
          JSON.stringify({ slug, source: 'sources/', items }, null, 2),
        )
        await fsp.writeFile(
          path.join(tmpDir, slug, 'index.json'),
          JSON.stringify({ slug, title: 'O', summary: '(refining)', tags: [], chunks: [] }, null, 2),
        )
      }) as any
    })
    // S2 item0: 两次重试都只写 chunk-001.md，从不更新 index.json（add_chunk 未调用）
    const writeOrphan = async () => {
      await fsp.writeFile(path.join(tmpDir, slug, 'chunks', 'chunk-001.md'), '# A')
    }
    mockCreatePiSession.mockImplementationOnce(async () => new FakeSession(FakeSession.readSourceThen(async () => { await writeOrphan() })) as any)
    mockCreatePiSession.mockImplementationOnce(async () => new FakeSession(FakeSession.readSourceThen(async () => { await writeOrphan() })) as any)
    // S3: 兜底成功（index.json chunks 为空也能跑，add_topic 只覆盖元数据）
    mockCreatePiSession.mockImplementation(async () => {
      return new FakeSession(FakeSession.addTopicHandler(['tag1'])) as any
    })

    const events = makeEvents()
    const result = await runLearnPipeline({
      sourceType: 'file',
      input: '# body',
      label: `${slug}.md`,
      port: 9999,
      events,
      docsDir: tmpDir,
    })

    expect(result.chunksWritten).toBe(0)
    expect(result.itemsFailed).toBe(1)
    const failed = events.calls.filter((c) => c.startsWith('stageItemFailed:'))
    expect(failed).toHaveLength(1)
    expect(failed[0]).toContain('add_chunk 未调用')
  })

  test('runPrompt 异常退出时在途轮次补 roundEnd：session 只 emit message_start 就 reject', async () => {
    // 自造一个 session：prompt 期间只发 assistant message_start 随后抛错（模拟 abort）
    const listeners = new Set<(ev: any) => void>()
    const broken = {
      sessionId: 'broken',
      subscribe: (fn: (ev: any) => void) => {
        listeners.add(fn)
        return () => { listeners.delete(fn) }
      },
      prompt: async () => {
        for (const l of listeners) l({ type: 'message_start', message: { role: 'assistant' } })
        throw new Error('aborted mid-round')
      },
      waitForIdle: async () => {},
      abort: async () => {},
    }
    mockCreatePiSession.mockImplementation(async () => broken as any)

    const events = makeEvents()
    await expect(
      runLearnPipeline({
        sourceType: 'file',
        input: '# body',
        label: 'x.md',
        port: 9999,
        events,
        docsDir: tmpDir,
      }),
    ).rejects.toThrow()

    // 轮次必须闭合：roundStart:0 有且仅有一次配对的 roundEnd:0
    expect(events.calls).toContain('roundStart:0')
    expect(events.calls.filter((c) => c === 'roundEnd:0')).toHaveLength(1)
  })

  // ============================================================
  // url 模式：crawl 阶段由 LLM agent 驱动
  // ============================================================

  test('url happy path：crawl 收集入口+同站子页，round 数 = assistant 消息数', async () => {
    crawlToolsMock.__setGraph({
      'https://pi.dev/': { title: 'Entry', text: 'Entry text', links: ['https://pi.dev/child'] },
      'https://pi.dev/child': { title: 'Child', text: 'Child text', links: [] },
    })

    const events = makeEvents()
    const result = await runLearnPipeline({
      sourceType: 'url',
      input: 'https://pi.dev/',
      port: 9999,
      events,
      docsDir: tmpDir,
    })

    // sources：入口 + 同站子页共 2 份
    const files = await fsp.readdir(path.join(tmpDir, 'pi', 'sources'))
    expect(files.filter((f) => f.endsWith('.md'))).toHaveLength(2)
    expect(result.slug).toBe('pi')
    expect(result.chunksWritten).toBe(1)

    // round：crawl + outline + refine + tag = 4 轮，起止索引严格配对
    expect(events.calls.filter((c) => c.startsWith('roundStart:'))).toEqual([
      'roundStart:0', 'roundStart:1', 'roundStart:2', 'roundStart:3',
    ])
    expect(events.calls.filter((c) => c.startsWith('roundEnd:'))).toEqual([
      'roundEnd:0', 'roundEnd:1', 'roundEnd:2', 'roundEnd:3',
    ])
  })

  test('url 首轮 0 页 → 全新 guard+session 重试 1 次后成功', async () => {
    crawlToolsMock.__setGraph({
      'https://pi.dev/': { title: 'Entry', text: 'Entry text', links: ['https://pi.dev/child'] },
      'https://pi.dev/child': { title: 'Child', text: 'Child text', links: [] },
    })

    // 第一个 crawl session：不保存任何页
    mockCreatePiSession.mockImplementationOnce(async () => new FakeSession(async () => {}) as any)

    const events = makeEvents()
    const result = await runLearnPipeline({
      sourceType: 'url',
      input: 'https://pi.dev/',
      port: 9999,
      events,
      docsDir: tmpDir,
    })

    // 两个 crawl session（guard 也重建）+ outline/refine/tag
    const crawlSessions = mockCreatePiSession.mock.calls.filter(([o]) => o.mode === 'crawl')
    expect(crawlSessions).toHaveLength(2)
    expect(crawlToolsMock.CrawlGuard).toHaveBeenCalledTimes(2)
    await expect(fsp.readdir(path.join(tmpDir, 'pi', 'sources'))).resolves.toHaveLength(2)
    expect(result.chunksWritten).toBe(1)

    // 总轮次：2 crawl + outline + refine + tag = 5
    expect(events.calls.filter((c) => c.startsWith('roundStart:'))).toHaveLength(5)
  })

  test('url 重试仍 0 页 → throw「crawl 未收集到页面」，guard 被关闭，stageEnd(outline) 发出', async () => {
    crawlToolsMock.__setGraph({
      'https://pi.dev/': { title: 'Entry', text: 'Entry text', links: [] },
    })

    // 两个 crawl session 均不保存页
    mockCreatePiSession.mockImplementationOnce(async () => new FakeSession(async () => {}) as any)
    mockCreatePiSession.mockImplementationOnce(async () => new FakeSession(async () => {}) as any)

    const events = makeEvents()
    await expect(
      runLearnPipeline({
        sourceType: 'url',
        input: 'https://pi.dev/',
        port: 9999,
        events,
        docsDir: tmpDir,
      }),
    ).rejects.toThrow(/crawl 未收集到页面/)

    // 建了 2 个 guard 且都被 close（finally 关闭当前 guard；首个 guard 在替换时关闭）
    expect(crawlToolsMock.CrawlGuard).toHaveBeenCalledTimes(2)
    const guards = crawlToolsMock.CrawlGuard.mock.instances as Array<{ closed: boolean }>
    expect(guards.every((g) => g.closed)).toBe(true)
    expect(events.calls).toContain('stageEnd:outline')
  })

  // ============================================================
  // 查重门接入（门1 outline 后 / 门2 tag 后）
  // ============================================================

  test('门1 match：outline 后命中 oldt → 物理并入 + 续号 chunk-002 + 对 oldt 跑 tag', async () => {
    await seedOldTopic('oldt')
    const slug = 'new-topic'

    // 门1 裁定命中：只新增条目 n
    mockReconcile.mockResolvedValueOnce({
      match: true,
      targetSlug: 'oldt',
      mergedTitle: 'M',
      mergedSummary: 's',
      itemsToAdd: [{ id: 'n', title: 'N', oneLine: 'n' }],
    })

    // S1: 门1 专用 seed（chunks: []）
    mockCreatePiSession.mockImplementationOnce(async () =>
      new FakeSession(gate1OutlineHandler(slug, [{ id: 'a', title: '概念A', oneLine: 'aaa' }])) as any)
    // S2（merge 后对 itemsToAdd 跑，startOffset=1）：写 chunk-002.md + 更新 dst index 注册
    mockCreatePiSession.mockImplementationOnce(async () =>
      new FakeSession(FakeSession.readSourceThen(async () => {
        await fsp.writeFile(path.join(tmpDir, 'oldt', 'chunks', 'chunk-002.md'), '# N')
        const idxPath = path.join(tmpDir, 'oldt', 'index.json')
        const idx = JSON.parse(await fsp.readFile(idxPath, 'utf8'))
        idx.chunks.push({ id: 'chunk-002', title: 'N', summary: 'n', tags: [] })
        await fsp.writeFile(idxPath, JSON.stringify(idx, null, 2))
      })) as any)
    // S3: 对 oldt 跑 tag，捕获 prompt
    const tagPrompts: string[] = []
    mockCreatePiSession.mockImplementationOnce(async () =>
      new FakeSession(tagCaptureHandler(tagPrompts)) as any)

    const result = await runLearnPipeline({
      sourceType: 'file',
      input: '# body',
      label: `${slug}.md`,
      port: 9999,
      events: makeEvents(),
      docsDir: tmpDir,
    })

    // 返回目标 slug；refine 只写了 1 个新增 chunk
    expect(result.slug).toBe('oldt')
    expect(result.chunksWritten).toBe(1)
    expect(result.itemsFailed).toBe(0)

    // oldt 原有 chunk-001 + 续号 chunk-002；src 目录已消失
    const chunks = await fsp.readdir(path.join(tmpDir, 'oldt', 'chunks'))
    expect(chunks).toEqual(expect.arrayContaining(['chunk-001.md', 'chunk-002.md']))
    await expect(fsp.access(path.join(tmpDir, slug))).rejects.toThrow()

    // 根 index 未新增主题，仍只有 oldt
    const root = JSON.parse(await fsp.readFile(path.join(tmpDir, 'index.json'), 'utf8'))
    expect(root.topics).toHaveLength(1)
    expect(root.topics[0].slug).toBe('oldt')

    // tag 对 oldt 执行，且 prompt 使用合并后的 override title/summary
    expect(tagPrompts).toHaveLength(1)
    expect(tagPrompts[0]).toContain('主题 slug: oldt')
    expect(tagPrompts[0]).toContain('M')
    expect(tagPrompts[0]).toContain('s')
  })

  test('门2 match：常规 S2/S3 后命中 oldt → src 消失、oldt 出现重编号 chunk、再对 oldt 跑 tag', async () => {
    await seedOldTopic('oldt')
    const slug = 'new-topic2'
    const items = [{ id: 'a', title: '概念A', oneLine: 'aaa' }]

    // reconcile 调用次序：门1 no-match → 门2 match
    mockReconcile.mockResolvedValueOnce({ match: false })
    mockReconcile.mockResolvedValueOnce({
      match: true,
      targetSlug: 'oldt',
      mergedTitle: 'M2',
      mergedSummary: 's2',
    })

    // S1: 常规 seed（chunks 带 chunk-001 ref）+ chunk 正文
    mockCreatePiSession.mockImplementationOnce(async () => new FakeSession(async () => {
      await fsp.mkdir(path.join(tmpDir, slug, 'chunks'), { recursive: true })
      await fsp.writeFile(
        path.join(tmpDir, slug, 'outline.json'),
        JSON.stringify({ slug, source: 'sources/', items }, null, 2),
      )
      await fsp.writeFile(
        path.join(tmpDir, slug, 'index.json'),
        JSON.stringify({ slug, title: 'New2', summary: '(refining)', tags: [], chunks: [
          { id: 'chunk-001', title: '概念A', summary: 'aaa', tags: [] },
        ] }, null, 2),
      )
      await fsp.writeFile(path.join(tmpDir, slug, 'chunks', 'chunk-001.md'), '# 概念A')
    }) as any)
    // S2 item0: chunk-001 已存在且已注册，仅 read_source 成功
    mockCreatePiSession.mockImplementationOnce(async () =>
      new FakeSession(FakeSession.readSourceThen(async () => {})) as any)
    // S3 第一次 tag：对 src slug
    // S3 第二次 tag（门2 merge 后）：对 oldt，使用 override
    const tagPrompts: string[] = []
    mockCreatePiSession.mockImplementationOnce(async () =>
      new FakeSession(tagCaptureHandler(tagPrompts)) as any)
    mockCreatePiSession.mockImplementationOnce(async () =>
      new FakeSession(tagCaptureHandler(tagPrompts)) as any)

    const result = await runLearnPipeline({
      sourceType: 'file',
      input: '# body',
      label: `${slug}.md`,
      port: 9999,
      events: makeEvents(),
      docsDir: tmpDir,
    })

    expect(result.slug).toBe('oldt')
    expect(result.chunksWritten).toBe(1)

    // src 目录消失；oldt 拿到重编号的迁移 chunk-002
    await expect(fsp.access(path.join(tmpDir, slug))).rejects.toThrow()
    const chunks = await fsp.readdir(path.join(tmpDir, 'oldt', 'chunks'))
    expect(chunks).toEqual(expect.arrayContaining(['chunk-001.md', 'chunk-002.md']))

    // tag 跑了两次：先 src，后 oldt（override M2/s2）
    expect(tagPrompts).toHaveLength(2)
    expect(tagPrompts[0]).toContain(`主题 slug: ${slug}`)
    expect(tagPrompts[1]).toContain('主题 slug: oldt')
    expect(tagPrompts[1]).toContain('M2')
    expect(tagPrompts[1]).toContain('s2')
  })

  // ============================================================
  // 门0：slug 精确命中（旁挂 / 还原）
  // ============================================================

  test('门0 match：同 slug 命中 → 旧 chunks 续号并入 + 新增 chunk-003，只保留 dup 目录', async () => {
    await seedDupTopic()

    // 门0 裁定命中：只新增条目 n（门1/门2 不再到达）
    mockReconcile.mockResolvedValueOnce({
      match: true,
      targetSlug: 'dup',
      mergedTitle: 'M',
      mergedSummary: 's',
      itemsToAdd: [{ id: 'n', title: 'N', oneLine: 'n' }],
    })

    // S1 outline session: 旁挂后 fresh dup 上写 outline + seed（chunks: []）
    mockCreatePiSession.mockImplementationOnce(async () =>
      new FakeSession(gate0OutlineHandler('dup', [{ id: 'a', title: '概念A', oneLine: 'aaa' }])) as any)
    // S2（merge 后 startOffset=2）：写 chunk-003.md + 在 dst index 注册
    mockCreatePiSession.mockImplementationOnce(async () =>
      new FakeSession(FakeSession.readSourceThen(async () => {
        await fsp.writeFile(path.join(tmpDir, 'dup', 'chunks', 'chunk-003.md'), '# N')
        const idxPath = path.join(tmpDir, 'dup', 'index.json')
        const idx = JSON.parse(await fsp.readFile(idxPath, 'utf8'))
        idx.chunks.push({ id: 'chunk-003', title: 'N', summary: 'n', tags: [] })
        await fsp.writeFile(idxPath, JSON.stringify(idx, null, 2))
      })) as any)
    // S3: 对 dup 带 merged override 跑 tag
    mockCreatePiSession.mockImplementationOnce(async () =>
      new FakeSession(FakeSession.addTopicHandler(['merged-tag'])) as any)

    const result = await runLearnPipeline({
      sourceType: 'file',
      input: '# new body',
      label: 'dup.md',
      port: 9999,
      events: makeEvents(),
      docsDir: tmpDir,
    })

    expect(result.slug).toBe('dup')
    expect(result.chunksWritten).toBe(1)
    expect(result.itemsFailed).toBe(0)

    // 只剩 dup 主题目录（无 dup.old）
    const dirs = (await fsp.readdir(tmpDir, { withFileTypes: true }))
      .filter((d) => d.isDirectory()).map((d) => d.name)
    expect(dirs).toEqual(['dup'])

    // 旧 2 chunks + 续号 003；旧正文逐字不变
    const chunks = await fsp.readdir(path.join(tmpDir, 'dup', 'chunks'))
    expect(chunks).toEqual(expect.arrayContaining(['chunk-001.md', 'chunk-002.md', 'chunk-003.md']))
    expect(await fsp.readFile(path.join(tmpDir, 'dup', 'chunks', 'chunk-001.md'), 'utf8')).toBe('OLD BODY 001\n')
    expect(await fsp.readFile(path.join(tmpDir, 'dup', 'chunks', 'chunk-002.md'), 'utf8')).toBe('OLD BODY 002\n')
  })

  test('门0 no-match：slug 碰撞 → 新内容另铸 dup-new 继续，旧 dup 原样还原', async () => {
    await seedDupTopic()
    mockMintSlug.mockResolvedValue('dup-new')
    // 门0/门1/门2 全部 no-match（默认值已满足，无需额外配置）

    // S1 outline session
    mockCreatePiSession.mockImplementationOnce(async () =>
      new FakeSession(gate0OutlineHandler('dup', [{ id: 'a', title: '概念A', oneLine: 'aaa' }])) as any)
    // S2：对 activeSlug=dup-new 写 chunk-001 + 注册
    mockCreatePiSession.mockImplementationOnce(async () =>
      new FakeSession(FakeSession.readSourceThen(async () => {
        await fsp.mkdir(path.join(tmpDir, 'dup-new', 'chunks'), { recursive: true })
        await fsp.writeFile(path.join(tmpDir, 'dup-new', 'chunks', 'chunk-001.md'), '# NEW')
        const idxPath = path.join(tmpDir, 'dup-new', 'index.json')
        const idx = JSON.parse(await fsp.readFile(idxPath, 'utf8'))
        idx.chunks.push({ id: 'chunk-001', title: '概念A', summary: 'aaa', tags: [] })
        await fsp.writeFile(idxPath, JSON.stringify(idx, null, 2))
      })) as any)
    // S3: 对 dup-new 常规 tag
    mockCreatePiSession.mockImplementationOnce(async () =>
      new FakeSession(FakeSession.addTopicHandler(['new-tag'])) as any)

    const result = await runLearnPipeline({
      sourceType: 'file',
      input: '# new body',
      label: 'dup.md',
      port: 9999,
      events: makeEvents(),
      docsDir: tmpDir,
    })

    expect(result.slug).toBe('dup-new')
    expect(result.chunksWritten).toBe(1)

    // 无 .old；dup 与 dup-new 两个主题目录共存
    const dirs = (await fsp.readdir(tmpDir, { withFileTypes: true }))
      .filter((d) => d.isDirectory()).map((d) => d.name).sort()
    expect(dirs).toEqual(['dup', 'dup-new'])

    // 旧 dup：2 个原始 chunks 正文原样，sources 原样
    expect(await fsp.readdir(path.join(tmpDir, 'dup', 'chunks')))
      .toEqual(expect.arrayContaining(['chunk-001.md', 'chunk-002.md']))
    expect(await fsp.readFile(path.join(tmpDir, 'dup', 'chunks', 'chunk-001.md'), 'utf8')).toBe('OLD BODY 001\n')
    expect(await fsp.readFile(path.join(tmpDir, 'dup', 'chunks', 'chunk-002.md'), 'utf8')).toBe('OLD BODY 002\n')
    expect(await fsp.readFile(path.join(tmpDir, 'dup', 'sources', 'source-001.md'), 'utf8')).toBe('OLD SOURCE\n')

    // 新 dup-new：自有 sources + 新 chunk
    expect(await fsp.readdir(path.join(tmpDir, 'dup-new', 'sources'))).toEqual(['source-001.md'])
    expect(await fsp.readFile(path.join(tmpDir, 'dup-new', 'chunks', 'chunk-001.md'), 'utf8')).toBe('# NEW')

    // 根 index：dup 与 dup-new 均登记
    const root = JSON.parse(await fsp.readFile(path.join(tmpDir, 'index.json'), 'utf8'))
    expect(root.topics.map((t: { slug: string }) => t.slug).sort()).toEqual(['dup', 'dup-new'])
  })

  test('阻断：assertNoOldDirs 抛错 → pipeline reject 且不创建任何 session', async () => {
    mockAssertNoOld.mockImplementation(() => {
      throw new Error('检测到未清理的旁挂目录 x.old，请手工处理后再学习')
    })

    await expect(
      runLearnPipeline({
        sourceType: 'file',
        input: '# body',
        label: 'any.md',
        port: 9999,
        events: makeEvents(),
        docsDir: tmpDir,
      }),
    ).rejects.toThrow(/检测到未清理的旁挂目录/)

    expect(mockCreatePiSession).not.toHaveBeenCalled()
  })
})

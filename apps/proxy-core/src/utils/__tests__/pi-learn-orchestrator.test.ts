import { promises as fsp } from 'node:fs'
import path from 'node:path'
import os from 'node:os'

// Mock pi-runtime: 每个测试通过 mockImplementationOnce 控制 createPiSession 的返回
jest.mock('../pi-runtime.js', () => ({
  createPiSession: jest.fn(),
}))

import { createPiSession } from '../pi-runtime.js'
import { runLearnPipeline, type LearnPipelineEvents } from '../pi-learn-orchestrator.js'

const mockCreatePiSession = createPiSession as jest.MockedFunction<typeof createPiSession>

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
    await this.handler(text)
    this.emit({ type: 'agent_end', messages: [], willRetry: false })
  }
  async waitForIdle(): Promise<void> {}
  async abort(): Promise<void> {}
  emit(ev: any): void {
    for (const l of this.listeners) l(ev)
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
    textDelta: () => {},
    thinkingDelta: () => {},
    toolStart: () => {},
    toolEnd: () => {},
  }
  return ev as unknown as LearnPipelineEvents & { calls: string[] }
}

// ---------- Test scaffolding ----------
let tmpDir: string

beforeEach(async () => {
  tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'learn-pipe-'))
  mockCreatePiSession.mockReset()
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
        prompt: 'https://example.com/x',
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

    // S1 outline session: 写 outline.json
    mockCreatePiSession.mockImplementationOnce(async () => {
      return new FakeSession(async () => {
        await fsp.mkdir(path.join(tmpDir, slug, 'chunks'), { recursive: true })
        await fsp.writeFile(
          path.join(tmpDir, slug, 'outline.json'),
          JSON.stringify({ slug, source: 'source.md', items }, null, 2),
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
    mockCreatePiSession.mockImplementationOnce(async () => new FakeSession(async () => { await writeChunk(0) }) as any)
    mockCreatePiSession.mockImplementationOnce(async () => new FakeSession(async () => {}) as any)
    mockCreatePiSession.mockImplementationOnce(async () => new FakeSession(async () => {}) as any)
    mockCreatePiSession.mockImplementationOnce(async () => new FakeSession(async () => { await writeChunk(2) }) as any)

    // S3 happy path: 写 tags
    mockCreatePiSession.mockImplementationOnce(async () => {
      return new FakeSession(async () => {
        const idxPath = path.join(tmpDir, slug, 'index.json')
        const idx = JSON.parse(await fsp.readFile(idxPath, 'utf8'))
        idx.tags = ['react', 'hooks', 'state-management']
        await fsp.writeFile(idxPath, JSON.stringify(idx, null, 2))
      }) as any
    })

    // 手动 seed index.json（真实流程由 add_outline 工具做，测试里没跑）
    await fsp.mkdir(path.join(tmpDir, slug), { recursive: true })
    await fsp.writeFile(
      path.join(tmpDir, slug, 'index.json'),
      JSON.stringify({ slug, title: 'My Topic', summary: '(refining)', tags: [], chunks: [
        { id: 'chunk-001', title: '概念A', summary: 'aaa', tags: [] },
        { id: 'chunk-003', title: '概念C', summary: 'ccc', tags: [] },
      ] }, null, 2),
    )

    const events = makeEvents()
    const result = await runLearnPipeline({
      prompt: 'https://example.com/x',
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

  test('S3 happy path：add_topic 被调用 → tags 非空 → stageEnd(tag)', async () => {
    const items = [{ id: 'a', title: '概念A', oneLine: 'aaa' }]
    const slug = 'happy-topic'

    // 预先 seed index.json + chunk（真实流程由 add_outline / add_chunk 工具写）
    await fsp.mkdir(path.join(tmpDir, slug, 'chunks'), { recursive: true })
    await fsp.writeFile(
      path.join(tmpDir, slug, 'index.json'),
      JSON.stringify({ slug, title: 'Happy', summary: '(refining)', tags: [], chunks: [
        { id: 'chunk-001', title: '概念A', summary: 'aaa', tags: [] },
      ] }, null, 2),
    )
    await fsp.writeFile(path.join(tmpDir, slug, 'chunks', 'chunk-001.md'), '# 概念A')

    // S1: session 写 outline.json
    mockCreatePiSession.mockImplementationOnce(async () => {
      return new FakeSession(async () => {
        await fsp.mkdir(path.join(tmpDir, slug, 'chunks'), { recursive: true })
        await fsp.writeFile(
          path.join(tmpDir, slug, 'outline.json'),
          JSON.stringify({ slug, source: 'source.md', items }, null, 2),
        )
      }) as any
    })
    // S2 item0: chunk-001.md 已存在，session 啥也不做
    mockCreatePiSession.mockImplementationOnce(async () => new FakeSession(async () => {}) as any)
    // S3: 写 tags
    mockCreatePiSession.mockImplementationOnce(async () => {
      return new FakeSession(async () => {
        const idxPath = path.join(tmpDir, slug, 'index.json')
        const idx = JSON.parse(await fsp.readFile(idxPath, 'utf8'))
        idx.tags = ['synonym-a', 'hypernym-b', 'scenario-c', 'confusable-d', 'question-e']
        await fsp.writeFile(idxPath, JSON.stringify(idx, null, 2))
      }) as any
    })

    const events = makeEvents()
    const result = await runLearnPipeline({
      prompt: 'x',
      port: 9999,
      events,
      docsDir: tmpDir,
    })

    expect(result.slug).toBe(slug)
    expect(events.calls).toContain('stageEnd:outline')
    expect(events.calls).toContain('stageEnd:refine')
    expect(events.calls).toContain('stageEnd:tag')
  })
})

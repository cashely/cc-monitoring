import { promises as fsp } from 'node:fs'
import path from 'node:path'
import os from 'node:os'

// Mock pi-runtime: 每个测试通过 mockImplementationOnce 控制 createPiSession 的返回
jest.mock('../pi-runtime.js', () => ({
  createPiSession: jest.fn(),
}))

// Mock pi-browser-tools: orchestrator 经 web-crawler 间接加载它，而其依赖 typebox（ESM）jest 无法 transform。
// 这些用例全部走 file 模式，crawlSite 不会被调用；web-crawler 的 slug 纯函数仍用真实实现。
jest.mock('../pi-browser-tools.js', () => ({
  runEgoBrowser: jest.fn(),
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
})

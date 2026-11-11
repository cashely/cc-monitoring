import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import path from 'path'
import { configureDbPath, initDatabase, closeDatabase, getDatabase } from '../db.js'
import {
  createRequestRecorder,
  recordIteration,
  listRequestDB,
  cleanOldRequestsDB,
  interruptStaleRequestsOnStartup,
  repairClosedRequests,
  isStreamCompleteEvents,
  reconstructUsageFromEvents,
  type RecordedRequest
} from '../request-writer.js'
import { pushNewRequest } from '../../server/data-push.js'

jest.mock('../../server/data-push.js', () => ({ pushNewRequest: jest.fn() }))

const pushMock = pushNewRequest as jest.Mock

let counter = 0

function makeMeta(tag: string): RecordedRequest {
  counter += 1
  const unique = `${tag}_${counter}`
  return {
    sessionId: `sess_${unique}`,
    localRequestId: `local_${unique}`,
    timestamp: new Date().toISOString(),
    apiKey: 'ak',
    proxyApiKey: 'pak',
    baseUrl: 'https://api.example.com',
    model: 'claude-test',
    machineId: 'mid',
    request: {
      method: 'POST',
      path: '/v1/messages',
      headers: { 'user-agent': 'ua-test' },
      body: { hello: 'world' }
    }
  }
}

function getRequestRow(requestId: string, sessionId: string): any {
  return getDatabase()
    .prepare('SELECT * FROM requests WHERE request_id = ? AND session_id = ?')
    .get(requestId, sessionId)
}

function getEventRows(requestId: string, sessionId: string): any[] {
  return getDatabase()
    .prepare('SELECT * FROM response_events WHERE request_id = ? AND session_id = ? ORDER BY event_index ASC')
    .all(requestId, sessionId)
}

// 直接插入一条 requests 行 + 指定数量的 response_events（cleanOldRequestsDB 测试用）
function insertRequestWithEvents(requestId: string, timestamp: string, eventCount: number): void {
  const db = getDatabase()
  db.prepare(`
    INSERT INTO requests (request_id, session_id, timestamp, method, path, status_code, response_time)
    VALUES (?, 'sess_clean', ?, 'POST', '/v1/messages', 200, 10)
  `).run(requestId, timestamp)
  const insEvent = db.prepare(
    'INSERT INTO response_events (request_id, session_id, event_index, event_data) VALUES (?, ?, ?, ?)'
  )
  for (let i = 0; i < eventCount; i++) {
    insEvent.run(requestId, 'sess_clean', i, `"e${i}"`)
  }
}

describe('request-writer', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = mkdtempSync(path.join(tmpdir(), 'ccm-rw-'))
    configureDbPath(path.join(tempDir, 'test.db'))
    initDatabase()
    pushMock.mockClear()
  })

  afterEach(() => {
    closeDatabase()
    rmSync(tempDir, { recursive: true, force: true })
  })

  it('pending() inserts a status_code=0 row and pushes pending', async () => {
    const meta = makeMeta('pending')
    const rec = createRequestRecorder(meta)
    await rec.pending()

    const row = getRequestRow(meta.localRequestId, meta.sessionId)
    expect(row).toBeTruthy()
    expect(row.status_code).toBe(0)
    expect(pushMock).toHaveBeenCalledTimes(1)
    expect(pushMock).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: meta.localRequestId,
        compositeId: `${meta.sessionId}:${meta.localRequestId}`,
        statusCode: 0,
        responseTime: 0
      }),
      'pending'
    )
  })

  it('appendEvent flushes full batches of 10; complete flushes residual events with continuous indexes', async () => {
    const meta = makeMeta('append')
    const rec = createRequestRecorder(meta)
    for (let i = 0; i < 12; i++) {
      rec.appendEvent({ type: 'chunk', seq: i })
    }

    // Without complete: only the full first batch is persisted, indexes 0..9
    let rows = getEventRows(meta.localRequestId, meta.sessionId)
    expect(rows).toHaveLength(10)
    expect(rows.map(r => r.event_index)).toEqual(Array.from({ length: 10 }, (_, i) => i))

    // Residual 2 events land at complete, full sequence 0..11 continuous
    await rec.complete({ statusCode: 200 })
    rows = getEventRows(meta.localRequestId, meta.sessionId)
    expect(rows).toHaveLength(12)
    expect(rows.map(r => r.event_index)).toEqual(Array.from({ length: 12 }, (_, i) => i))
  })

  it('complete() with same id writes completed row, token columns and pushes completed without pendingId', async () => {
    const meta = makeMeta('same')
    const rec = createRequestRecorder(meta)
    await rec.pending()
    rec.appendEvent({ type: 'message_start' })
    rec.appendEvent({
      type: 'message_delta',
      usage: {
        input_tokens: 10,
        output_tokens: 5,
        cache_read_input_tokens: 2,
        cache_creation_input_tokens: 1
      }
    })
    await rec.complete({ statusCode: 200, headers: { 'x-test': '1' } })

    const row = getRequestRow(meta.localRequestId, meta.sessionId)
    expect(row.status_code).toBe(200)
    expect(row.completed_at).toBeTruthy()
    expect(row.input_tokens).toBe(10)
    expect(row.output_tokens).toBe(5)
    expect(row.cache_read_tokens).toBe(2)
    expect(row.cache_creation_tokens).toBe(1)

    const completedCalls = pushMock.mock.calls.filter(c => c[1] === 'completed')
    expect(completedCalls).toHaveLength(1)
    const summary = completedCalls[0][0]
    expect(summary.statusCode).toBe(200)
    expect(summary.usage.output_tokens).toBe(5)
    expect(summary.pendingId).toBeUndefined()
  })

  it('complete() with a different cloud id moves requests row and events to cloud id and pushes pendingId', async () => {
    const meta = makeMeta('cloud')
    counter += 1
    const cloudId = `cloud_${counter}`
    const rec = createRequestRecorder(meta)
    await rec.pending()
    for (let i = 0; i < 12; i++) {
      rec.appendEvent({ type: 'chunk', seq: i })
    }
    await rec.complete({ cloudRequestId: cloudId, statusCode: 200 })

    // Local row and local events are gone
    expect(getRequestRow(meta.localRequestId, meta.sessionId)).toBeFalsy()
    expect(getEventRows(meta.localRequestId, meta.sessionId)).toHaveLength(0)

    // Cloud row exists and is completed
    const cloudRow = getRequestRow(cloudId, meta.sessionId)
    expect(cloudRow).toBeTruthy()
    expect(cloudRow.status_code).toBe(200)

    // Events moved with continuous indexes
    const cloudEvents = getEventRows(cloudId, meta.sessionId)
    expect(cloudEvents).toHaveLength(12)
    expect(cloudEvents.map(r => r.event_index)).toEqual(Array.from({ length: 12 }, (_, i) => i))

    const completedCalls = pushMock.mock.calls.filter(c => c[1] === 'completed')
    expect(completedCalls).toHaveLength(1)
    const summary = completedCalls[0][0]
    expect(summary.requestId).toBe(cloudId)
    expect(summary.pendingId).toBe(`${meta.sessionId}:${meta.localRequestId}`)
  })

  it('complete() migration leaves pre-existing events of another session with the same localRequestId untouched', async () => {
    const meta = makeMeta('residue')
    counter += 1
    const cloudId = `cloud_${counter}`
    const oldSession = 'sess_old_residue'

    // recorder 创建之前：相同 localRequestId、不同 session_id 的历史残留事件
    const preIns = getDatabase().prepare(
      'INSERT INTO response_events (request_id, session_id, event_index, event_data) VALUES (?, ?, ?, ?)'
    )
    preIns.run(meta.localRequestId, oldSession, 0, '"old0"')
    preIns.run(meta.localRequestId, oldSession, 1, '"old1"')

    const rec = createRequestRecorder(meta)
    await rec.pending()
    for (let i = 0; i < 3; i++) {
      rec.appendEvent({ type: 'chunk', seq: i })
    }
    await rec.complete({ cloudRequestId: cloudId, statusCode: 200 })

    // 预写事件 request_id 不变（未被迁走）
    const staleRows = getEventRows(meta.localRequestId, oldSession)
    expect(staleRows).toHaveLength(2)
    expect(staleRows.map(r => [r.request_id, r.event_index])).toEqual([
      [meta.localRequestId, 0],
      [meta.localRequestId, 1]
    ])

    // 本 recorder 的事件迁到 cloudId，localId 下无事件残留
    expect(getEventRows(meta.localRequestId, meta.sessionId)).toHaveLength(0)
    const moved = getEventRows(cloudId, meta.sessionId)
    expect(moved).toHaveLength(3)
    expect(moved.map(r => r.event_index)).toEqual([0, 1, 2])
  })

  it('complete() migration leaves same-session historical events with the same localRequestId untouched', async () => {
    const meta = makeMeta('sameresidue')
    counter += 1
    const cloudId = `cloud_${counter}`

    // recorder 创建之前：相同 localRequestId、相同 session_id 的历史残留
    // （模拟 req-N 计数器复用后同 session 残留）。用不与新请求重叠的 event_index，
    // 避免唯一索引 + INSERT OR IGNORE 干扰本用例对迁移行为的验证。
    const preIns = getDatabase().prepare(
      'INSERT INTO response_events (request_id, session_id, event_index, event_data) VALUES (?, ?, ?, ?)'
    )
    preIns.run(meta.localRequestId, meta.sessionId, 50, '"old0"')
    preIns.run(meta.localRequestId, meta.sessionId, 51, '"old1"')

    const rec = createRequestRecorder(meta)
    await rec.pending()
    for (let i = 0; i < 3; i++) {
      rec.appendEvent({ type: 'chunk', seq: i })
    }
    await rec.complete({ cloudRequestId: cloudId, statusCode: 200 })

    // 预写的 2 行 request_id 仍为 localRequestId（未被迁走）
    const staleRows = getEventRows(meta.localRequestId, meta.sessionId)
    expect(staleRows).toHaveLength(2)
    expect(staleRows.map(r => [r.request_id, r.event_index])).toEqual([
      [meta.localRequestId, 50],
      [meta.localRequestId, 51]
    ])

    // recorder 自己的事件迁到 cloudId
    const moved = getEventRows(cloudId, meta.sessionId)
    expect(moved).toHaveLength(3)
    expect(moved.map(r => r.event_index)).toEqual([0, 1, 2])
  })

  it('fail() updates the pending row status/error/closed_at and pushes completed', async () => {
    const meta = makeMeta('fail')
    const rec = createRequestRecorder(meta)
    await rec.pending()
    rec.fail({ statusCode: 502, error: 'Target server unreachable' })

    const row = getRequestRow(meta.localRequestId, meta.sessionId)
    expect(row).toBeTruthy()
    expect(row.status_code).toBe(502)
    expect(row.error).toBe('Target server unreachable')
    expect(row.closed_at).toBeTruthy()
    expect(row.status_code).not.toBe(0)

    const completedCalls = pushMock.mock.calls.filter(c => c[1] === 'completed')
    expect(completedCalls).toHaveLength(1)
  })

  it('recordIteration() writes a completed row and events with no pending row', async () => {
    const meta = makeMeta('iter')
    await recordIteration({
      ...meta,
      response: {
        statusCode: 200,
        events: [
          { type: 'message', content: [] },
          { type: 'message_delta', usage: { output_tokens: 7 } }
        ]
      }
    })

    const row = getRequestRow(meta.localRequestId, meta.sessionId)
    expect(row).toBeTruthy()
    expect(row.status_code).toBe(200)
    expect(row.completed_at).toBeTruthy()
    expect(getEventRows(meta.localRequestId, meta.sessionId)).toHaveLength(2)

    const pendingCount = (getDatabase()
      .prepare('SELECT COUNT(*) AS c FROM requests WHERE status_code = 0')
      .get() as any).c
    expect(pendingCount).toBe(0)

    const completedCalls = pushMock.mock.calls.filter(c => c[1] === 'completed')
    expect(completedCalls).toHaveLength(1)
    expect(completedCalls[0][0].pendingId).toBeUndefined()
  })

  it('complete() synthesizes message_delta from OpenAI usage and persists output_tokens=42', async () => {
    const meta = makeMeta('openai')
    const rec = createRequestRecorder(meta)
    await rec.pending()
    rec.appendEvent({ type: 'chat.completion.chunk' })
    rec.appendEvent({ type: 'chat.completion', usage: { prompt_tokens: 8, completion_tokens: 42 } })
    await rec.complete({ statusCode: 200 })

    const row = getRequestRow(meta.localRequestId, meta.sessionId)
    expect(row.output_tokens).toBe(42)

    const deltaRows = getEventRows(meta.localRequestId, meta.sessionId)
      .filter(r => r.event_type === 'message_delta')
    expect(deltaRows.length).toBeGreaterThan(0)
    const parsed = JSON.parse(deltaRows[deltaRows.length - 1].event_data)
    expect(parsed.type).toBe('message_delta')
    expect(parsed.usage.output_tokens).toBe(42)
  })

  it('headers() writes real status_code while completed_at stays NULL and pushes pending', async () => {
    const meta = makeMeta('headers')
    const rec = createRequestRecorder(meta)
    await rec.pending()
    pushMock.mockClear()

    rec.headers({ statusCode: 200, headers: { 'content-type': 'text/event-stream' } })

    const row = getRequestRow(meta.localRequestId, meta.sessionId)
    expect(row.status_code).toBe(200)
    expect(row.completed_at).toBeNull()
    expect(row.closed_at).toBeNull()
    expect(JSON.parse(row.response_headers)['content-type']).toBe('text/event-stream')

    expect(pushMock).toHaveBeenCalledTimes(1)
    expect(pushMock).toHaveBeenCalledWith(
      expect.objectContaining({ requestId: meta.localRequestId, statusCode: 200, responseTime: 0 }),
      'pending'
    )
  })

  it('interrupt() flushes events and writes closed_at/error keeping passed status_code, pushes completed with closedAt', async () => {
    const meta = makeMeta('interrupt')
    const rec = createRequestRecorder(meta)
    await rec.pending()
    rec.appendEvent({ type: 'chunk', seq: 1 })
    pushMock.mockClear()

    rec.interrupt({ statusCode: 200, error: 'stream interrupted: socket hang up' })

    const row = getRequestRow(meta.localRequestId, meta.sessionId)
    expect(row.status_code).toBe(200)
    expect(row.completed_at).toBeNull()
    expect(row.closed_at).toBeTruthy()
    expect(row.error).toBe('stream interrupted: socket hang up')

    // 剩余事件在中断前已落库
    expect(getEventRows(meta.localRequestId, meta.sessionId)).toHaveLength(1)

    expect(pushMock).toHaveBeenCalledTimes(1)
    expect(pushMock).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: meta.localRequestId,
        statusCode: 200,
        closedAt: expect.any(String)
      }),
      'completed'
    )
  })

  it('listRequestDB maps closed_at to closedAt only on closed rows', async () => {
    const closedMeta = makeMeta('listclosed')
    const closedRec = createRequestRecorder(closedMeta)
    await closedRec.pending()
    closedRec.interrupt({ statusCode: 200, error: 'boom' })

    const openMeta = makeMeta('listopen')
    const openRec = createRequestRecorder(openMeta)
    await openRec.pending()
    await openRec.complete({ statusCode: 200 })

    const { requests } = await listRequestDB()
    const closed = requests.find(r => r.requestId === closedMeta.localRequestId)
    const open = requests.find(r => r.requestId === openMeta.localRequestId)
    expect(closed).toBeTruthy()
    expect(closed!.closedAt).toEqual(expect.any(String))
    expect(closed!.error).toBe('boom')
    expect(open).toBeTruthy()
    expect(open!.closedAt).toBeUndefined()
    expect(open!.error).toBeUndefined()
  })

  it('interruptStaleRequestsOnStartup() marks aged orphan rows and leaves fresh/completed rows untouched', async () => {
    // 超龄无主行：已收到响应头（200），时间戳回拨到 6 分钟前
    const oldMeta = makeMeta('staleold')
    const oldRec = createRequestRecorder(oldMeta)
    await oldRec.pending()
    oldRec.headers({ statusCode: 200 })
    getDatabase()
      .prepare('UPDATE requests SET timestamp = ? WHERE request_id = ? AND session_id = ?')
      .run(new Date(Date.now() - 6 * 60000).toISOString(), oldMeta.localRequestId, oldMeta.sessionId)

    // 刚 pending 的新行，不超龄
    const freshMeta = makeMeta('stalefresh')
    const freshRec = createRequestRecorder(freshMeta)
    await freshRec.pending()

    // 超龄但已完成的行
    const doneMeta = makeMeta('staledone')
    const doneRec = createRequestRecorder(doneMeta)
    await doneRec.pending()
    await doneRec.complete({ statusCode: 200 })
    getDatabase()
      .prepare('UPDATE requests SET timestamp = ? WHERE request_id = ? AND session_id = ?')
      .run(new Date(Date.now() - 6 * 60000).toISOString(), doneMeta.localRequestId, doneMeta.sessionId)

    const { completed, interrupted } = interruptStaleRequestsOnStartup()

    expect(completed).toBe(0)
    expect(interrupted).toBe(1)

    const oldRow = getRequestRow(oldMeta.localRequestId, oldMeta.sessionId)
    expect(oldRow.closed_at).toBeTruthy()
    expect(oldRow.error).toBe('interrupted: proxy restarted')
    expect(oldRow.status_code).toBe(200)
    expect(oldRow.completed_at).toBeNull()

    const freshRow = getRequestRow(freshMeta.localRequestId, freshMeta.sessionId)
    expect(freshRow.closed_at).toBeNull()
    expect(freshRow.error).toBeNull()

    const doneRow = getRequestRow(doneMeta.localRequestId, doneMeta.sessionId)
    expect(doneRow.closed_at).toBeNull()
  })

  it('harvests an aged pending row ending with message_stop as completed: completed_at set, closed_at/error empty, tokens backfilled', async () => {
    const meta = makeMeta('stopcomplete')
    const rec = createRequestRecorder(meta)
    await rec.pending()
    rec.headers({ statusCode: 200 })
    rec.appendEvent({
      type: 'message_start',
      usage: { input_tokens: 100, cache_read_input_tokens: 10, cache_creation_input_tokens: 2, output_tokens: 1 }
    })
    // 17 内容事件：总事件数 20（整批落库），message_start 在尾部 10 条窗口之外，
    // 依赖定向 SQL 取锚点事件
    for (let i = 0; i < 17; i++) {
      rec.appendEvent({ type: 'content_block_delta', seq: i })
    }
    rec.appendEvent({ type: 'message_delta', usage: { output_tokens: 50 } })
    rec.appendEvent({ type: 'message_stop' })

    getDatabase()
      .prepare('UPDATE requests SET timestamp = ? WHERE request_id = ? AND session_id = ?')
      .run(new Date(Date.now() - 6 * 60000).toISOString(), meta.localRequestId, meta.sessionId)

    const { completed, interrupted } = interruptStaleRequestsOnStartup()
    expect(completed).toBe(1)
    expect(interrupted).toBe(0)

    const row = getRequestRow(meta.localRequestId, meta.sessionId)
    expect(row.completed_at).toBeTruthy()
    expect(row.closed_at).toBeNull()
    expect(row.error).toBeNull()
    expect(row.status_code).toBe(200)
    expect(row.response_time).toBeGreaterThan(0)
    expect(row.input_tokens).toBe(100)
    expect(row.output_tokens).toBe(50)
    expect(row.cache_read_tokens).toBe(10)
    expect(row.cache_creation_tokens).toBe(2)
  })

  it('aged row without message_stop stays interrupted but tokens are backfilled when usage is recoverable', async () => {
    const meta = makeMeta('stopmissing')
    const rec = createRequestRecorder(meta)
    await rec.pending()
    rec.headers({ statusCode: 200 })
    rec.appendEvent({
      type: 'message_start',
      usage: { input_tokens: 30, cache_read_input_tokens: 3, cache_creation_input_tokens: 1 }
    })
    for (let i = 0; i < 18; i++) {
      rec.appendEvent({ type: 'content_block_delta', seq: i })
    }
    rec.appendEvent({ type: 'message_delta', usage: { output_tokens: 12 } })

    getDatabase()
      .prepare('UPDATE requests SET timestamp = ? WHERE request_id = ? AND session_id = ?')
      .run(new Date(Date.now() - 6 * 60000).toISOString(), meta.localRequestId, meta.sessionId)

    const { completed, interrupted } = interruptStaleRequestsOnStartup()
    expect(completed).toBe(0)
    expect(interrupted).toBe(1)

    const row = getRequestRow(meta.localRequestId, meta.sessionId)
    expect(row.closed_at).toBeTruthy()
    expect(row.error).toBe('interrupted: proxy restarted')
    expect(row.completed_at).toBeNull()
    expect(row.input_tokens).toBe(30)
    expect(row.output_tokens).toBe(12)
    expect(row.cache_read_tokens).toBe(3)
    expect(row.cache_creation_tokens).toBe(1)
  })

  it('reconstructUsageFromEvents merges message_start base with message_delta into all four fields (field-level, not overwrite)', () => {
    const usage = reconstructUsageFromEvents([
      { type: 'message_start', usage: { input_tokens: 100, output_tokens: 1, cache_read_input_tokens: 80, cache_creation_input_tokens: 5 } },
      { type: 'content_block_delta' },
      { type: 'message_delta', usage: { output_tokens: 42 } }
    ])

    expect(usage).toEqual({
      input_tokens: 100,
      output_tokens: 42,
      cache_read_input_tokens: 80,
      cache_creation_input_tokens: 5
    })
  })

  it('message_delta cache fields are merged too, and undefined is returned when no usage exists', () => {
    const usage = reconstructUsageFromEvents([
      { type: 'message_start', usage: { input_tokens: 10 } },
      { type: 'message_delta', usage: { output_tokens: 4, cache_read_input_tokens: 2 } }
    ])
    expect(usage).toEqual({ input_tokens: 10, output_tokens: 4, cache_read_input_tokens: 2 })

    expect(reconstructUsageFromEvents([{ type: 'content_block_delta' }])).toBeUndefined()
  })

  it('OpenAI-style: choices[0].finish_reason non-empty marks complete, and a chunk with usage backfills tokens', async () => {
    expect(isStreamCompleteEvents([
      { choices: [{ delta: { role: 'assistant' }, finish_reason: null }] }
    ])).toBe(false)
    expect(isStreamCompleteEvents([
      { choices: [{ delta: {}, finish_reason: 'stop' }] }
    ])).toBe(true)

    const usage = reconstructUsageFromEvents([
      { choices: [{ delta: { content: 'hi' }, finish_reason: null }] },
      { choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 9, completion_tokens: 17 } }
    ])
    expect(usage).toEqual({ input_tokens: 9, output_tokens: 17 })

    // 端到端：OpenAI 超龄行（事件 event_type 为 NULL）走完成语义并回填
    const meta = makeMeta('openaistop')
    const rec = createRequestRecorder(meta)
    await rec.pending()
    rec.headers({ statusCode: 200 })
    for (let i = 0; i < 19; i++) {
      rec.appendEvent({ choices: [{ delta: { content: 'x' }, finish_reason: null }] })
    }
    rec.appendEvent({ choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 9, completion_tokens: 17 } })

    getDatabase()
      .prepare('UPDATE requests SET timestamp = ? WHERE request_id = ? AND session_id = ?')
      .run(new Date(Date.now() - 6 * 60000).toISOString(), meta.localRequestId, meta.sessionId)

    const { completed, interrupted } = interruptStaleRequestsOnStartup()
    expect(completed).toBe(1)
    expect(interrupted).toBe(0)

    const row = getRequestRow(meta.localRequestId, meta.sessionId)
    expect(row.completed_at).toBeTruthy()
    expect(row.closed_at).toBeNull()
    expect(row.input_tokens).toBe(9)
    expect(row.output_tokens).toBe(17)
  })

  it('interrupt() also backfills recoverable token columns', async () => {
    const meta = makeMeta('interrupttokens')
    const rec = createRequestRecorder(meta)
    await rec.pending()
    rec.appendEvent({
      type: 'message_start',
      usage: { input_tokens: 20, cache_read_input_tokens: 4, cache_creation_input_tokens: 1 }
    })
    for (let i = 0; i < 20; i++) {
      rec.appendEvent({ type: 'content_block_delta', seq: i })
    }
    rec.appendEvent({ type: 'message_delta', usage: { output_tokens: 7 } })
    pushMock.mockClear()

    rec.interrupt({ statusCode: 200, error: 'stream interrupted: socket hang up' })

    const row = getRequestRow(meta.localRequestId, meta.sessionId)
    expect(row.closed_at).toBeTruthy()
    expect(row.error).toBe('stream interrupted: socket hang up')
    expect(row.input_tokens).toBe(20)
    expect(row.output_tokens).toBe(7)
    expect(row.cache_read_tokens).toBe(4)
    expect(row.cache_creation_tokens).toBe(1)

    const completedCalls = pushMock.mock.calls.filter(c => c[1] === 'completed')
    expect(completedCalls[0][0].usage).toEqual(expect.objectContaining({ output_tokens: 7 }))
  })

  it('repairClosedRequests recovers closed complete rows, fills tokens, and is idempotent', async () => {
    // 完整但被旧逻辑误标中断的行：message_stop 已入库，token 全 NULL
    const completeMeta = makeMeta('repaircomplete')
    const completeRec = createRequestRecorder(completeMeta)
    await completeRec.pending()
    completeRec.appendEvent({
      type: 'message_start',
      usage: { input_tokens: 15, cache_read_input_tokens: 2, cache_creation_input_tokens: 1 }
    })
    for (let i = 0; i < 20; i++) {
      completeRec.appendEvent({ type: 'content_block_delta', seq: i })
    }
    completeRec.appendEvent({ type: 'message_delta', usage: { output_tokens: 6 } })
    completeRec.appendEvent({ type: 'message_stop' })
    completeRec.interrupt({ statusCode: 200, error: 'interrupted: proxy restarted' })
    // 模拟旧版本中断行：清空 token 列（旧 interrupt 不回填 usage）
    getDatabase()
      .prepare(`UPDATE requests SET
        input_tokens = NULL, output_tokens = NULL,
        cache_read_tokens = NULL, cache_creation_tokens = NULL
        WHERE request_id = ? AND session_id = ?`)
      .run(completeMeta.localRequestId, completeMeta.sessionId)

    // 真正中断的行：无 message_stop，但 usage 可恢复
    const brokenMeta = makeMeta('repairbroken')
    const brokenRec = createRequestRecorder(brokenMeta)
    await brokenRec.pending()
    brokenRec.appendEvent({
      type: 'message_start',
      usage: { input_tokens: 8, cache_read_input_tokens: 1 }
    })
    for (let i = 0; i < 20; i++) {
      brokenRec.appendEvent({ type: 'content_block_delta', seq: i })
    }
    brokenRec.appendEvent({ type: 'message_delta', usage: { output_tokens: 3 } })
    brokenRec.interrupt({ statusCode: 200, error: 'interrupted: proxy restarted' })
    // 模拟旧版本中断行：清空 token 列
    getDatabase()
      .prepare(`UPDATE requests SET
        input_tokens = NULL, output_tokens = NULL,
        cache_read_tokens = NULL, cache_creation_tokens = NULL
        WHERE request_id = ? AND session_id = ?`)
      .run(brokenMeta.localRequestId, brokenMeta.sessionId)

    const first = repairClosedRequests()
    expect(first.recovered).toBe(1)
    expect(first.tokensFilled).toBe(2)

    const recoveredRow = getRequestRow(completeMeta.localRequestId, completeMeta.sessionId)
    expect(recoveredRow.closed_at).toBeNull()
    expect(recoveredRow.error).toBeNull()
    expect(recoveredRow.completed_at).toBeTruthy()
    expect(recoveredRow.input_tokens).toBe(15)
    expect(recoveredRow.output_tokens).toBe(6)

    const brokenRow = getRequestRow(brokenMeta.localRequestId, brokenMeta.sessionId)
    expect(brokenRow.closed_at).toBeTruthy()
    expect(brokenRow.input_tokens).toBe(8)
    expect(brokenRow.output_tokens).toBe(3)

    // 幂等：第二次不产生任何变更，行状态保持
    const second = repairClosedRequests()
    expect(second).toEqual({ recovered: 0, tokensFilled: 0 })

    const rerunRecovered = getRequestRow(completeMeta.localRequestId, completeMeta.sessionId)
    expect(rerunRecovered.completed_at).toBe(recoveredRow.completed_at)
    const rerunBroken = getRequestRow(brokenMeta.localRequestId, brokenMeta.sessionId)
    expect(rerunBroken.closed_at).toBe(brokenRow.closed_at)
  })

  it('cleanOldRequestsDB() deletes old requests/events in batches and keeps recent ones', async () => {
    // 旧请求 req-old-1 带 5003 个事件：response_events 分批循环（每批 5000）至少跑 2 批
    const insertAll = getDatabase().transaction(() => {
      insertRequestWithEvents('req-old-1', new Date(Date.now() - 30 * 86400000).toISOString(), 5003)
      insertRequestWithEvents('req-old-2', new Date(Date.now() - 30 * 86400000).toISOString(), 2)
      insertRequestWithEvents('req-new', new Date().toISOString(), 3)
    })
    insertAll()

    await cleanOldRequestsDB(7)

    // 旧 requests 删除，新 requests 保留
    expect(getRequestRow('req-old-1', 'sess_clean')).toBeFalsy()
    expect(getRequestRow('req-old-2', 'sess_clean')).toBeFalsy()
    expect(getRequestRow('req-new', 'sess_clean')).toBeTruthy()

    // 旧 events 删除，新 events 保留且 event_index 连续
    expect(getEventRows('req-old-1', 'sess_clean')).toHaveLength(0)
    expect(getEventRows('req-old-2', 'sess_clean')).toHaveLength(0)
    const newEvents = getEventRows('req-new', 'sess_clean')
    expect(newEvents).toHaveLength(3)
    expect(newEvents.map(r => r.event_index)).toEqual([0, 1, 2])
  })

  it('cleanOldRequestsDB(0) keeps all requests and events', async () => {
    insertRequestWithEvents('req-old', new Date(Date.now() - 30 * 86400000).toISOString(), 2)
    insertRequestWithEvents('req-new', new Date().toISOString(), 1)

    await cleanOldRequestsDB(0)

    expect(getRequestRow('req-old', 'sess_clean')).toBeTruthy()
    expect(getRequestRow('req-new', 'sess_clean')).toBeTruthy()
    expect(getEventRows('req-old', 'sess_clean')).toHaveLength(2)
    expect(getEventRows('req-new', 'sess_clean')).toHaveLength(1)
  })
})

import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import path from 'path'
import { configureDbPath, initDatabase, closeDatabase, getDatabase } from '../db.js'
import { startDbWorker, stopDbWorker, dbCall } from '../db-worker-client.js'
import {
  createRequestRecorder,
  loadRequestDB,
  listRequestDB,
  cleanOldRequestsDB
} from '../request-writer.js'
import { pushNewRequest } from '../../server/data-push.js'
import type { RecordedRequest } from '../request-writer.js'

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

// 屏障：fire-and-forget（headers / 攒批落库）后用一条入队更晚的消息等 worker
// 处理完此前全部消息
async function workerSync(): Promise<void> {
  await dbCall('recorder.start', { sessionId: 'barrier', localRequestId: 'barrier' })
}

// 直接插入一条 requests 行 + 指定数量的 response_events（cleanup 测试用）
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

describe('request-writer (db worker)', () => {
  let tempDir: string
  let dbPath: string

  beforeEach(() => {
    tempDir = mkdtempSync(path.join(tmpdir(), 'ccm-rw-'))
    dbPath = path.join(tempDir, 'test.db')
    // 主线程先建库（schema + migration），worker 启动后同库开独立连接
    configureDbPath(dbPath)
    initDatabase()
    startDbWorker(dbPath)
    pushMock.mockClear()
  })

  afterEach(async () => {
    await stopDbWorker()
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
    await workerSync()

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

  it('pending → headers → complete reaches terminal state with real status and response headers', async () => {
    const meta = makeMeta('chain')
    const rec = createRequestRecorder(meta)
    await rec.pending()
    rec.headers({ statusCode: 200, headers: { 'content-type': 'text/event-stream' } })
    await workerSync()

    let row = getRequestRow(meta.localRequestId, meta.sessionId)
    expect(row.status_code).toBe(200)
    expect(row.completed_at).toBeNull()
    expect(row.closed_at).toBeNull()
    expect(JSON.parse(row.response_headers)['content-type']).toBe('text/event-stream')

    rec.appendEvent({ type: 'message_delta', usage: { output_tokens: 3 } })
    await rec.complete({ statusCode: 200, headers: { 'content-type': 'text/event-stream' } })

    row = getRequestRow(meta.localRequestId, meta.sessionId)
    expect(row.status_code).toBe(200)
    expect(row.completed_at).toBeTruthy()
    expect(row.closed_at).toBeNull()
    expect(row.output_tokens).toBe(3)

    const pushKinds = pushMock.mock.calls.map(c => c[1])
    expect(pushKinds).toEqual(['pending', 'pending', 'completed'])
  })

  it('complete() same id writes token columns and pushes completed without pendingId', async () => {
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
    expect(row.input_tokens).toBe(10)
    expect(row.output_tokens).toBe(5)
    expect(row.cache_read_tokens).toBe(2)
    expect(row.cache_creation_tokens).toBe(1)

    const completedCalls = pushMock.mock.calls.filter(c => c[1] === 'completed')
    expect(completedCalls).toHaveLength(1)
    expect(completedCalls[0][0].pendingId).toBeUndefined()
  })

  it('complete() with a different cloud id moves events to cloud id, deletes local row and pushes pendingId', async () => {
    const meta = makeMeta('cloud')
    counter += 1
    const cloudId = `cloud_${counter}`
    const rec = createRequestRecorder(meta)
    await rec.pending()
    for (let i = 0; i < 12; i++) {
      rec.appendEvent({ type: 'chunk', seq: i })
    }
    await rec.complete({ cloudRequestId: cloudId, statusCode: 200 })

    // Local row deleted and local events gone
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

  it('interrupt() flushes events, writes closed_at/error and pushes completed with recoverable usage', async () => {
    const meta = makeMeta('interrupt')
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

    await rec.interrupt({ statusCode: 200, error: 'stream interrupted: socket hang up' })

    const row = getRequestRow(meta.localRequestId, meta.sessionId)
    expect(row.status_code).toBe(200)
    expect(row.completed_at).toBeNull()
    expect(row.closed_at).toBeTruthy()
    expect(row.error).toBe('stream interrupted: socket hang up')
    expect(row.input_tokens).toBe(20)
    expect(row.output_tokens).toBe(7)
    expect(row.cache_read_tokens).toBe(4)
    expect(row.cache_creation_tokens).toBe(1)

    // 剩余事件在中断前已落库（22 条）
    expect(getEventRows(meta.localRequestId, meta.sessionId)).toHaveLength(22)

    expect(pushMock).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: meta.localRequestId,
        statusCode: 200,
        closedAt: expect.any(String),
        usage: expect.objectContaining({ output_tokens: 7 })
      }),
      'completed'
    )
  })

  it('fail() updates status/error/closed_at without reconstructing usage and pushes completed', async () => {
    const meta = makeMeta('fail')
    const rec = createRequestRecorder(meta)
    await rec.pending()
    rec.appendEvent({ type: 'message_delta', usage: { output_tokens: 9 } })

    await rec.fail({ statusCode: 502, error: 'Target server unreachable' })

    const row = getRequestRow(meta.localRequestId, meta.sessionId)
    expect(row.status_code).toBe(502)
    expect(row.error).toBe('Target server unreachable')
    expect(row.closed_at).toBeTruthy()
    // fail 不重建 usage：token 列保持 NULL
    expect(row.output_tokens).toBeNull()

    const completedCalls = pushMock.mock.calls.filter(c => c[1] === 'completed')
    expect(completedCalls).toHaveLength(1)
    expect(completedCalls[0][0].usage).toBeUndefined()
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

  it('loadRequestDB() returns the row with parsed headers, body and events', async () => {
    const meta = makeMeta('load')
    const rec = createRequestRecorder(meta)
    await rec.pending()
    rec.appendEvent({ type: 'message_start', usage: { input_tokens: 5 } })
    rec.appendEvent({ type: 'message_delta', usage: { output_tokens: 2 } })
    await rec.complete({ statusCode: 200, headers: { 'content-type': 'text/event-stream' } })

    const loaded = await loadRequestDB(`${meta.sessionId}:${meta.localRequestId}`)
    expect(loaded.requestId).toBe(meta.localRequestId)
    expect(loaded.sessionId).toBe(meta.sessionId)
    expect(loaded.request.method).toBe('POST')
    expect(loaded.request.headers['user-agent']).toBe('ua-test')
    expect(loaded.request.body).toEqual({ hello: 'world' })
    expect(loaded.response?.statusCode).toBe(200)
    expect(loaded.response?.headers?.['content-type']).toBe('text/event-stream')
    expect(loaded.response?.events).toHaveLength(2)
    expect(loaded.response?.closedAt).toBeNull()

    await expect(loadRequestDB(`${meta.sessionId}:missing`)).rejects.toThrow(/Request not found/)
    await expect(loadRequestDB('bad-format')).rejects.toThrow(/Invalid compositeId/)
  })

  it('listRequestDB() maps rows to summaries: closedAt/error only on closed rows', async () => {
    const closedMeta = makeMeta('listclosed')
    const closedRec = createRequestRecorder(closedMeta)
    await closedRec.pending()
    await closedRec.interrupt({ statusCode: 200, error: 'boom' })

    const openMeta = makeMeta('listopen')
    const openRec = createRequestRecorder(openMeta)
    await openRec.pending()
    await openRec.complete({ statusCode: 200 })

    const { requests, hasMore } = await listRequestDB()
    expect(hasMore).toBe(false)
    const closed = requests.find(r => r.requestId === closedMeta.localRequestId)
    const open = requests.find(r => r.requestId === openMeta.localRequestId)
    expect(closed).toBeTruthy()
    expect(closed!.closedAt).toEqual(expect.any(String))
    expect(closed!.error).toBe('boom')
    expect(closed!.compositeId).toBe(`${closedMeta.sessionId}:${closedMeta.localRequestId}`)
    expect(open).toBeTruthy()
    expect(open!.closedAt).toBeUndefined()
    expect(open!.error).toBeUndefined()
  })

  it('listRequestDB() cursor pagination: before + limit + hasMore', async () => {
    for (let i = 0; i < 3; i++) {
      const m = makeMeta(`page${i}`)
      const r = createRequestRecorder(m)
      await r.pending()
      await r.complete({ statusCode: 200 })
    }

    const page1 = await listRequestDB(2)
    expect(page1.requests).toHaveLength(2)
    expect(page1.hasMore).toBe(true)

    const page2 = await listRequestDB(2, page1.requests[1].timestamp)
    expect(page2.requests.length).toBeGreaterThan(0)
    expect(page2.requests.every(r => r.timestamp < page1.requests[1].timestamp)).toBe(true)
    const allIds = [...page1.requests, ...page2.requests].map(r => r.compositeId)
    expect(new Set(allIds).size).toBe(allIds.length)
  })

  it('cleanOldRequestsDB() deletes old requests/events in batches (5003 events => multiple batches)', async () => {
    // 旧请求 req-old-1 带 5003 个事件：response_events 分批循环（每批 5000）至少 2 批
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

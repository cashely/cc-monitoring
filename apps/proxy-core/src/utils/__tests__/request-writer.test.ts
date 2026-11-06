import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import path from 'path'
import { configureDbPath, initDatabase, closeDatabase, getDatabase } from '../db.js'
import {
  createRequestRecorder,
  recordIteration,
  listRequestDB,
  interruptStaleRequestsOnStartup,
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
    expect(open).toBeTruthy()
    expect(open!.closedAt).toBeUndefined()
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

    const count = interruptStaleRequestsOnStartup()

    expect(count).toBe(1)

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
})

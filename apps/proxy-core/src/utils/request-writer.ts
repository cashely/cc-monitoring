import { initDatabase, getDatabase } from './db.js'
import { dbCall } from './db-worker-client.js'
import { parseUpstreamEvents } from './inject-loop.js'
import { pushNewRequest } from '../server/data-push.js'

export interface RecordedRequest {
  sessionId: string
  localRequestId: string
  timestamp: string
  apiKey?: string
  proxyApiKey?: string
  baseUrl?: string
  model?: string
  machineId?: string
  request: {
    method: string
    path: string
    headers: Record<string, string>
    body?: any
  }
}

export interface TokenUsage {
  input_tokens?: number
  output_tokens?: number
  cache_read_input_tokens?: number
  cache_creation_input_tokens?: number
}

export interface RequestSummary {
  requestId: string
  sessionId: string
  compositeId: string
  timestamp: string
  method: string
  path: string
  statusCode: number
  responseTime: number
  apiKey?: string
  proxyApiKey?: string
  baseUrl?: string
  model?: string
  machineId?: string
  userAgent?: string
  usage?: TokenUsage
  closedAt?: string
  error?: string
}

export interface RequestRecorder {
  pending(): Promise<void>
  appendEvent(event: any): void
  headers(args: { statusCode: number; headers?: Record<string, string> }): void
  complete(args: { cloudRequestId?: string; statusCode: number; headers?: Record<string, string> }): Promise<void>
  interrupt(args: { statusCode: number; error: string }): Promise<void>
  fail(args: { statusCode: number; error: string }): Promise<void>
}

interface LoadedRequest {
  requestId: string
  sessionId: string
  timestamp: string
  apiKey?: string
  proxyApiKey?: string
  baseUrl?: string
  model?: string
  machineId?: string
  request: {
    method: string
    path: string
    headers: Record<string, string>
    body?: any
  }
  response?: {
    statusCode: number
    headers?: Record<string, string>
    events?: any[]
    completedAt?: string
    closedAt?: string
    error?: string
  }
}

// --- Private implementation ---

const EVENT_BATCH_SIZE = 10

interface EventEntry {
  index: number
  type?: string
  data: unknown
}

// 送到 worker 的 requests 行载荷（snake_case 列名转 camelCase）
interface RequestRowPayload {
  requestId: string
  sessionId: string
  timestamp: string
  method: string
  path: string
  statusCode: number
  responseTime: number
  apiKey?: string
  proxyApiKey?: string
  baseUrl?: string
  model?: string
  machineId?: string
  userAgent?: string
  inputTokens?: number
  outputTokens?: number
  cacheReadTokens?: number
  cacheCreationTokens?: number
  requestHeaders: Record<string, string>
  requestBody?: any
  responseHeaders?: Record<string, string>
  completedAt?: string
  closedAt?: string
  error?: string
}

interface RowArgs {
  meta: RecordedRequest
  requestId: string
  statusCode: number
  responseTime: number
  headers?: Record<string, string>
  usage?: TokenUsage
  completedAt?: string
  closedAt?: string
  error?: string
}

function buildRowPayload(args: RowArgs): RequestRowPayload {
  const { meta } = args
  return {
    requestId: args.requestId,
    sessionId: meta.sessionId,
    timestamp: meta.timestamp,
    method: meta.request.method,
    path: meta.request.path,
    statusCode: args.statusCode,
    responseTime: args.responseTime,
    apiKey: meta.apiKey,
    proxyApiKey: meta.proxyApiKey,
    baseUrl: meta.baseUrl,
    model: meta.model,
    machineId: meta.machineId,
    userAgent: meta.request.headers['user-agent'],
    inputTokens: args.usage?.input_tokens,
    outputTokens: args.usage?.output_tokens,
    cacheReadTokens: args.usage?.cache_read_input_tokens,
    cacheCreationTokens: args.usage?.cache_creation_input_tokens,
    requestHeaders: meta.request.headers,
    requestBody: meta.request.body,
    responseHeaders: args.headers,
    completedAt: args.completedAt,
    closedAt: args.closedAt,
    error: args.error
  }
}

/**
 * 把一批 SSE 事件送到 worker 落库。fire-and-forget：同一通道严格按入队顺序
 * 处理，先入队的批次不会乱序。
 */
function flushEventBatch(
  sessionId: string,
  requestId: string,
  batch: EventEntry[],
  startIndex: number
): void {
  void dbCall('events.insertBatch', batch.map((event, i) => ({
    requestId,
    sessionId,
    index: startIndex + i,
    type: event.type ?? null,
    data: event.data
  })))
}

function extractUsage(events: any[] | undefined): TokenUsage | undefined {
  if (!events) return undefined
  const messageDelta = events.find((e: any) => e?.type === 'message_delta')
  return messageDelta?.usage
}

// --- 流完整性判定与 usage 重建（纯函数，事件数组入参）---

/**
 * 判断事件集合是否构成一条完整返回的流。
 * Claude：出现 type === 'message_stop'。
 * OpenAI 兼容：chunk 内 choices[0].finish_reason 非空
 * （[DONE] 不入库，不能作为 DB 判定依据）。
 */
export function isStreamCompleteEvents(events: any[] | undefined): boolean {
  if (!Array.isArray(events)) return false
  return events.some(e => {
    if (!e || typeof e !== 'object') return false
    if (e.type === 'message_stop') return true
    const finishReason = e.choices?.[0]?.finish_reason
    return finishReason !== undefined && finishReason !== null && finishReason !== ''
  })
}

/**
 * 从事件集合按字段合并重建 usage，不做整体覆盖。
 * Claude：message_start.usage（input_tokens / cache_*）为底；
 * message_delta.usage 的字段优先（output_tokens 为主，cache 字段也合入）。
 * OpenAI：取带 .usage 的 chunk（prompt_tokens/completion_tokens）。
 */
export function reconstructUsageFromEvents(events: any[] | undefined): TokenUsage | undefined {
  if (!Array.isArray(events)) return undefined
  const usage: TokenUsage = {}
  let found = false

  const merge = (field: keyof TokenUsage, value: unknown, precedence: boolean): void => {
    if (typeof value !== 'number') return
    if (precedence || usage[field] === undefined) {
      usage[field] = value
      found = true
    }
  }

  for (const e of events) {
    if (!e || typeof e !== 'object') continue

    if (e.type === 'message_start' || e.type === 'message_delta') {
      const u = e.usage
      if (u && typeof u === 'object') {
        const isDelta = e.type === 'message_delta'
        merge('input_tokens', u.input_tokens, isDelta)
        merge('output_tokens', u.output_tokens, isDelta)
        merge('cache_read_input_tokens', u.cache_read_input_tokens, isDelta)
        merge('cache_creation_input_tokens', u.cache_creation_input_tokens, isDelta)
      }
    }

    // OpenAI 兼容：带 usage 的 chunk（event_type 通常为 NULL）
    if (e.usage && typeof e.usage === 'object' && e.type !== 'message_start' && e.type !== 'message_delta') {
      const u = e.usage
      merge('input_tokens', u.input_tokens ?? u.prompt_tokens, false)
      merge('output_tokens', u.output_tokens ?? u.completion_tokens, false)
    }
  }

  return found ? usage : undefined
}

type TokenColumn = 'input_tokens' | 'output_tokens' | 'cache_read_tokens' | 'cache_creation_tokens'

// 以下两个主线程版本仅供 interruptStaleRequestsOnStartup / repairClosedRequests /
// loadSessionHistory 使用（这些函数走主线程连接，与 worker 连接 WAL 共存）。
// recorder 的运行时事件读写全部走 worker，见 createRequestRecorder。

// 定向加载重建所需事件，禁止全量加载事件流（实测有 8000+ 行）：
// 1) Claude 锚点事件（message_start/message_delta/message_stop，通常仅数行）
// 2) 尾部 10 条事件（覆盖 OpenAI 的 finish_reason / usage，其 event_type 可能为 NULL）
function loadTargetedEvents(
  db: import('better-sqlite3').Database,
  requestId: string,
  sessionId: string
): any[] {
  const anchorRows = db.prepare(`
    SELECT event_data FROM response_events
    WHERE request_id = ? AND session_id = ?
      AND event_type IN ('message_start', 'message_delta', 'message_stop')
    ORDER BY event_index ASC
  `).all(requestId, sessionId) as { event_data: string }[]

  const tailRows = db.prepare(`
    SELECT event_data FROM response_events
    WHERE request_id = ? AND session_id = ?
    ORDER BY event_index DESC
    LIMIT 10
  `).all(requestId, sessionId) as { event_data: string }[]

  const seen = new Set<string>()
  const events: any[] = []
  for (const row of [...anchorRows, ...tailRows]) {
    if (seen.has(row.event_data)) continue
    seen.add(row.event_data)
    try {
      events.push(JSON.parse(row.event_data))
    } catch {
      // 忽略损坏行
    }
  }
  return events
}

// 按字段回填 token 列（只补 NULL 列），返回是否有列被更新
function fillTokenColumns(
  db: import('better-sqlite3').Database,
  requestId: string,
  sessionId: string,
  usage: TokenUsage
): boolean {
  const current = db.prepare(`
    SELECT input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens
    FROM requests WHERE request_id = ? AND session_id = ?
  `).get(requestId, sessionId) as Record<TokenColumn, number | null> | undefined
  if (!current) return false

  const pairs: [TokenColumn, number | undefined][] = [
    ['input_tokens', usage.input_tokens],
    ['output_tokens', usage.output_tokens],
    ['cache_read_tokens', usage.cache_read_input_tokens],
    ['cache_creation_tokens', usage.cache_creation_input_tokens]
  ]
  const updatable = pairs.filter(([col, v]) => current[col] === null && typeof v === 'number') as [TokenColumn, number][]
  if (updatable.length === 0) return false

  const setSql = updatable.map(([col]) => `${col} = ?`).join(', ')
  db.prepare(
    `UPDATE requests SET ${setSql} WHERE request_id = ? AND session_id = ?`
  ).run(...updatable.map(([, v]) => v), requestId, sessionId)
  return true
}

function buildSummary(
  meta: RecordedRequest,
  requestId: string,
  statusCode: number,
  responseTime: number,
  usage: TokenUsage | undefined,
  withPendingId: boolean,
  closedAt?: string
): RequestSummary & { pendingId?: string } {
  return {
    requestId,
    sessionId: meta.sessionId,
    compositeId: `${meta.sessionId}:${requestId}`,
    timestamp: meta.timestamp,
    method: meta.request.method,
    path: meta.request.path,
    statusCode,
    responseTime,
    baseUrl: meta.baseUrl,
    model: meta.model,
    machineId: meta.machineId,
    userAgent: meta.request.headers['user-agent'],
    usage,
    pendingId: withPendingId ? `${meta.sessionId}:${meta.localRequestId}` : undefined,
    closedAt
  }
}

// --- Public API ---

export function createRequestRecorder(meta: RecordedRequest): RequestRecorder {
  const eventBatch: EventEntry[] = []
  const tailBuffer: any[] = []
  let eventIndex = 0
  const startTime = Date.now()
  let pendingCalled = false

  // recorder 生命周期开始前的事件行下界，由 pending() 时向 worker 取。
  // complete() 把事件从 localRequestId 迁到 cloudRequestId 时只允许迁移 id 大于
  // 它的行：request_id（req-N 计数器）在进程重启后可能复用，同 localRequestId
  // 的历史残留事件属于别的请求，不能被一起迁走。
  let startEventRowId: number | null = null

  function flushRemaining(): void {
    if (eventBatch.length > 0) {
      flushEventBatch(meta.sessionId, meta.localRequestId, eventBatch, eventIndex - eventBatch.length)
      eventBatch.length = 0
    }
  }

  function appendEvent(event: any): void {
    const entry: EventEntry = { index: eventIndex, type: event?.type, data: event }
    eventBatch.push(entry)

    // Maintain tail buffer (last 5 events for usage extraction)
    tailBuffer.push(event)
    if (tailBuffer.length > 5) {
      tailBuffer.shift()
    }

    // Flush batch to DB when threshold reached
    if (eventBatch.length >= EVENT_BATCH_SIZE) {
      flushEventBatch(meta.sessionId, meta.localRequestId, eventBatch, eventIndex - eventBatch.length + 1)
      eventBatch.length = 0 // Reset batch (memory freed)
    }

    eventIndex++
  }

  return {
    async pending(): Promise<void> {
      if (pendingCalled) return
      pendingCalled = true

      // 先取迁移守卫下界，再写 pending 占位行（worker 严格按顺序执行）
      const res = await dbCall<{ startEventRowId: number }>(
        'recorder.start',
        { sessionId: meta.sessionId, localRequestId: meta.localRequestId }
      )
      startEventRowId = res.startEventRowId
      await dbCall('requests.insertPending', buildRowPayload({
        meta,
        requestId: meta.localRequestId,
        statusCode: 0,
        responseTime: 0
      }))
      pushNewRequest(buildSummary(meta, meta.localRequestId, 0, 0, undefined, false), 'pending')
    },

    appendEvent,

    // 上游响应头到达：回写真实 status_code，状态仍 pending（UI 保留 spinner）
    headers({ statusCode, headers }): void {
      void dbCall('requests.updateHeaders', {
        requestId: meta.localRequestId,
        sessionId: meta.sessionId,
        statusCode,
        headers
      })

      pushNewRequest(
        buildSummary(meta, meta.localRequestId, statusCode, 0, undefined, false, undefined),
        'pending'
      )
    },

    async complete({ cloudRequestId, statusCode, headers }): Promise<void> {
      // Flush remaining events in batch
      flushRemaining()

      // Usage synthesis: prefer message_delta, otherwise convert OpenAI-style usage
      let usage = extractUsage(tailBuffer)
      if (!usage) {
        const openaiEvent = tailBuffer.find((e: any) => e?.usage)
        if (openaiEvent) {
          appendEvent({
            type: 'message_delta',
            usage: {
              output_tokens: openaiEvent.usage.completion_tokens || 0
            }
          })
          usage = extractUsage(tailBuffer)
        }
      }
      // Ensure the synthetic event (if any) is written before row replacement
      flushRemaining()

      const completedAt = new Date().toISOString()
      const finalId = cloudRequestId ?? meta.localRequestId
      const responseTime = Date.now() - startTime

      // 防御：未经过 pending() 直接 complete（如纯事件测试），补取迁移下界
      if (startEventRowId === null) {
        const res = await dbCall<{ startEventRowId: number }>(
          'recorder.start',
          { sessionId: meta.sessionId, localRequestId: meta.localRequestId }
        )
        startEventRowId = res.startEventRowId
      }

      await dbCall('requests.complete', {
        row: buildRowPayload({
          meta, requestId: finalId, statusCode, responseTime, headers, usage, completedAt
        }),
        localId: meta.localRequestId,
        sessionId: meta.sessionId,
        startEventRowId
      })

      pushNewRequest(
        buildSummary(meta, finalId, statusCode, responseTime, usage, finalId !== meta.localRequestId),
        'completed'
      )
    },

    // 流被截断/挂死：保留真实 status_code，通过 closed_at + error 标记中断；
    // worker 内同时做定向 SQL（锚点事件 + 尾部事件）usage 重建与 token 回填，
    // 返回 usage 供 UI 推送使用。
    async interrupt({ statusCode, error }): Promise<void> {
      flushRemaining()
      const responseTime = Date.now() - startTime
      const closedAt = new Date().toISOString()

      const res = await dbCall<{ usage?: TokenUsage }>('requests.interrupt', {
        requestId: meta.localRequestId,
        sessionId: meta.sessionId,
        statusCode,
        responseTime,
        closedAt,
        error
      })

      pushNewRequest(
        buildSummary(meta, meta.localRequestId, statusCode, responseTime, res.usage, false, closedAt),
        'completed'
      )
    },

    async fail({ statusCode, error }): Promise<void> {
      const responseTime = Date.now() - startTime
      const closedAt = new Date().toISOString()

      await dbCall('requests.fail', {
        requestId: meta.localRequestId,
        sessionId: meta.sessionId,
        statusCode,
        responseTime,
        closedAt,
        error
      })

      pushNewRequest(
        buildSummary(meta, meta.localRequestId, statusCode, responseTime, undefined, false, closedAt),
        'completed'
      )
    }
  }
}

// Record an inject loop iteration: completed row + events + push, no pending, responseTime 0
export async function recordIteration(
  meta: RecordedRequest & {
    response: { statusCode: number; headers?: Record<string, string>; events?: any[] }
  }
): Promise<void> {
  initDatabase()

  const events = meta.response.events ?? []
  if (events.length > 0) {
    await dbCall('events.insertBatch', events.map((e: any, i: number) => ({
      requestId: meta.localRequestId,
      sessionId: meta.sessionId,
      index: i,
      type: e?.type ?? null,
      data: e
    })))
  }

  const usage = extractUsage(events)
  const completedAt = new Date().toISOString()

  // 无 pending 占位：终态行直接写入（finalId==localId 路径）
  await dbCall('requests.complete', {
    row: buildRowPayload({
      meta,
      requestId: meta.localRequestId,
      statusCode: meta.response.statusCode,
      responseTime: 0,
      headers: meta.response.headers,
      usage,
      completedAt
    }),
    localId: meta.localRequestId,
    sessionId: meta.sessionId,
    startEventRowId: 0
  })

  pushNewRequest(
    buildSummary(meta, meta.localRequestId, meta.response.statusCode, 0, usage, false),
    'completed'
  )
}

// Load single request by compositeId (sessionId:requestId)
export async function loadRequestDB(compositeId: string): Promise<LoadedRequest> {
  return dbCall('requests.get', { compositeId })
}

// List requests with cursor pagination (summary, sorted by timestamp desc)
export async function listRequestDB(
  limit: number = 1000,
  before?: string
): Promise<{ requests: RequestSummary[]; hasMore: boolean }> {
  return dbCall('requests.list', { limit, before })
}

// Clean old requests (time window based, configurable)
// daysToKeep <= 0 means no cleanup (keep all data)
export async function cleanOldRequestsDB(daysToKeep = 7): Promise<void> {
  if (daysToKeep <= 0) {
    // No cleanup, keep all historical data
    return
  }

  const cutoffIso = new Date(Date.now() - daysToKeep * 86400000).toISOString()
  await dbCall('requests.cleanup', { cutoffIso })
}

// 启动时回收上次进程遗留的僵尸 SSE 行：未完成、未关闭且超龄，逐行分流
// （status_code 保持原值不动）——事件流完整（message_stop / OpenAI finish_reason）
// 的走完成语义：写 completed_at，不写 closed_at/error；不完整的维持
// closed_at + 'interrupted: proxy restarted'。两条路径都按字段回填 token 列。
export function interruptStaleRequestsOnStartup(
  maxAgeMs = 5 * 60000
): { completed: number; interrupted: number } {
  const db = initDatabase()
  const cutoff = new Date(Date.now() - maxAgeMs).toISOString()

  const rows = db.prepare(`
    SELECT request_id, session_id, timestamp, response_time
    FROM requests
    WHERE completed_at IS NULL AND closed_at IS NULL AND timestamp < ?
  `).all(cutoff) as {
    request_id: string
    session_id: string
    timestamp: string
    response_time: number
  }[]

  let completed = 0
  let interrupted = 0
  const nowIso = new Date().toISOString()

  for (const row of rows) {
    const events = loadTargetedEvents(db, row.request_id, row.session_id)
    const usage = reconstructUsageFromEvents(events)

    if (isStreamCompleteEvents(events)) {
      // response_time 原值为 0（pending 占位）时，用 timestamp→现在给合理值
      const responseTime = row.response_time > 0
        ? row.response_time
        : Math.max(0, Date.now() - Date.parse(row.timestamp))
      db.prepare(
        'UPDATE requests SET completed_at = ?, response_time = ? WHERE request_id = ? AND session_id = ?'
      ).run(nowIso, responseTime, row.request_id, row.session_id)
      completed += 1
    } else {
      db.prepare(
        'UPDATE requests SET closed_at = ?, error = ? WHERE request_id = ? AND session_id = ?'
      ).run(nowIso, 'interrupted: proxy restarted', row.request_id, row.session_id)
      interrupted += 1
    }

    if (usage) {
      fillTokenColumns(db, row.request_id, row.session_id, usage)
    }
  }

  return { completed, interrupted }
}

// 存量回填（供 CLI repair-requests 使用），幂等可重跑：
// 扫描 closed_at 非空的行——事件流完整且 completed_at 为空的：清 closed_at/error、
// 写 completed_at（completed_at 已非空的跳过）；对 token 全 NULL 但事件可恢复
// usage 的行按字段补 token。同样只走定向 SQL。
export function repairClosedRequests(): { recovered: number; tokensFilled: number } {
  const db = initDatabase()

  const rows = db.prepare(`
    SELECT
      request_id, session_id, completed_at,
      input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens
    FROM requests
    WHERE closed_at IS NOT NULL
  `).all() as ({
    request_id: string
    session_id: string
    completed_at: string | null
  } & Record<TokenColumn, number | null>)[]

  let recovered = 0
  let tokensFilled = 0
  const nowIso = new Date().toISOString()

  for (const row of rows) {
    const events = loadTargetedEvents(db, row.request_id, row.session_id)

    if (row.completed_at === null && isStreamCompleteEvents(events)) {
      db.prepare(
        'UPDATE requests SET closed_at = NULL, error = NULL, completed_at = ? WHERE request_id = ? AND session_id = ?'
      ).run(nowIso, row.request_id, row.session_id)
      recovered += 1
    }

    const allTokensNull =
      row.input_tokens === null &&
      row.output_tokens === null &&
      row.cache_read_tokens === null &&
      row.cache_creation_tokens === null
    if (allTokensNull) {
      const usage = reconstructUsageFromEvents(events)
      if (usage && fillTokenColumns(db, row.request_id, row.session_id, usage)) {
        tokensFilled += 1
      }
    }
  }

  return { recovered, tokensFilled }
}

// Load session history for multi-turn chat resume
// Returns the last request's messages + assistant response, to prepend to new messages
export function loadSessionHistory(sessionId: string): { messages: any[], system?: any } | null {
  const db = initDatabase()

  // Get the last completed request for this session
  const row = db.prepare(`
    SELECT request_id, request_body, response_headers
    FROM requests
    WHERE session_id = ? AND completed_at IS NOT NULL AND status_code = 200
    ORDER BY timestamp DESC
    LIMIT 1
  `).get(sessionId) as { request_id: string, request_body: string | null, response_headers: string | null } | undefined

  if (!row) return null

  let requestBody: any = null
  try {
    requestBody = row.request_body ? JSON.parse(row.request_body) : null
  } catch { return null }

  // Load response events from separate table; fallback to old JSON column for historical data
  const eventRows = db.prepare(`
    SELECT event_data FROM response_events
    WHERE request_id = ? AND session_id = ?
    ORDER BY event_index ASC
  `).all(row.request_id, sessionId) as any[]

  let responseEvents: any[]
  if (eventRows.length > 0) {
    try {
      responseEvents = eventRows.map(r => JSON.parse(r.event_data))
    } catch { responseEvents = [] }
  } else {
    // Fallback: read from old requests.response_events JSON column
    const legacyRow = db.prepare('SELECT response_events FROM requests WHERE request_id = ? AND session_id = ?')
      .get(row.request_id, sessionId) as { response_events: string | null } | undefined
    try {
      responseEvents = legacyRow?.response_events ? JSON.parse(legacyRow.response_events) : []
    } catch { responseEvents = [] }
  }

  if (!requestBody?.messages) return null

  // Rebuild conversation: previous messages from request_body + assistant response from response_events
  const messages = [...requestBody.messages]

  // Extract assistant content from response events
  // For JSON responses, the first event is the full response with .content
  // For SSE responses, need to parse content blocks
  const firstEvent = responseEvents[0]
  if (firstEvent?.type === 'message' && firstEvent?.content) {
    // JSON (non-streaming) response
    messages.push({ role: 'assistant', content: firstEvent.content })
  } else if (responseEvents.length > 1) {
    // SSE response — rebuild content blocks from events
    const parsed = parseUpstreamEvents(responseEvents)
    const assistantContent: any[] = []
    for (const block of parsed.blocks) {
      if (block.type === 'text' && block.text) {
        assistantContent.push({ type: 'text', text: block.text })
      } else if (block.type === 'tool_use') {
        assistantContent.push({ type: 'tool_use', id: block.id, name: block.name, input: block.input })
      }
    }
    // Find tool_result blocks in subsequent events
    for (const event of responseEvents) {
      if (event?.type === 'tool_result' || (event?.role === 'user' && Array.isArray(event?.content))) {
        messages.push({ role: 'user', content: event.content })
      }
    }
    if (assistantContent.length > 0) {
      messages.push({ role: 'assistant', content: assistantContent })
    }
  }

  return {
    messages,
    system: requestBody.system || requestBody.system_prompt
  }
}

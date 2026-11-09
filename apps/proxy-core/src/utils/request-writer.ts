import { initDatabase, getDatabase } from './db.js'
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
  interrupt(args: { statusCode: number; error: string }): void
  fail(args: { statusCode: number; error: string }): void
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

// Cached prepared statement for batch writes
let insertEventStmt: import('better-sqlite3').Statement | null = null
let cachedDbInstance: import('better-sqlite3').Database | null = null

// Invalidate cached stmt when DB instance changes (tests create fresh DB per suite)
function ensureStmtCacheValid(db: import('better-sqlite3').Database): void {
  if (db !== cachedDbInstance) {
    insertEventStmt = null
    cachedDbInstance = db
  }
}

/**
 * Flush a batch of SSE events to the response_events table.
 */
function flushEventBatch(
  sessionId: string,
  requestId: string,
  batch: EventEntry[],
  startIndex: number
): void {
  const db = getDatabase()
  ensureStmtCacheValid(db)
  if (!insertEventStmt) {
    insertEventStmt = db.prepare(
      'INSERT OR IGNORE INTO response_events (request_id, session_id, event_index, event_type, event_data) VALUES (?, ?, ?, ?, ?)'
    )
  }
  for (let i = 0; i < batch.length; i++) {
    const event = batch[i]
    insertEventStmt.run(
      requestId,
      sessionId,
      startIndex + i,
      event.type ?? null,
      JSON.stringify(event.data)
    )
  }
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

type TokenColumn = 'input_tokens' | 'output_tokens' | 'cache_read_tokens' | 'cache_creation_tokens'

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
  const updatable = pairs.filter(([col, v]) => current[col] === null && typeof v === 'number')
  if (updatable.length === 0) return false

  const setSql = updatable.map(([col]) => `${col} = ?`).join(', ')
  db.prepare(
    `UPDATE requests SET ${setSql} WHERE request_id = ? AND session_id = ?`
  ).run(...updatable.map(([, v]) => v as number), requestId, sessionId)
  return true
}

interface CompletedRowArgs {
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

function writeCompletedRow(args: CompletedRowArgs): void {
  const db = getDatabase()
  const { meta } = args

  const stmt = db.prepare(`
    INSERT OR REPLACE INTO requests (
      request_id, session_id, timestamp, method, path, status_code, response_time,
      api_key, proxy_api_key, base_url, model, machine_id, user_agent,
      input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens,
      request_headers, request_body, response_headers, response_events,
      completed_at, closed_at, error
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
    )
  `)

  stmt.run(
    args.requestId,
    meta.sessionId,
    meta.timestamp,
    meta.request.method,
    meta.request.path,
    args.statusCode,
    args.responseTime,
    meta.apiKey || null,
    meta.proxyApiKey || null,
    meta.baseUrl || null,
    meta.model || null,
    meta.machineId || null,
    meta.request.headers['user-agent'] || null,
    args.usage?.input_tokens || null,
    args.usage?.output_tokens || null,
    args.usage?.cache_read_input_tokens || null,
    args.usage?.cache_creation_input_tokens || null,
    JSON.stringify(meta.request.headers),
    meta.request.body ? JSON.stringify(meta.request.body) : null,
    args.headers ? JSON.stringify(args.headers) : null,
    null,  // response_events now stored in separate table
    args.completedAt || null,
    args.closedAt || null,
    args.error || null
  )
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

  // recorder 生命周期开始前的事件行下界。complete() 把事件从 localRequestId 迁到
  // cloudRequestId 时只允许迁移 id 大于它的行：request_id（req-N 计数器）在进程
  // 重启后可能复用，同 localRequestId 的历史残留事件属于别的请求，不能被一起迁走。
  const startRow = getDatabase()
    .prepare('SELECT MAX(id) AS m FROM response_events')
    .get() as { m: number | null }
  const startEventRowId = startRow.m ?? 0

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

      writeCompletedRow({
        meta,
        requestId: meta.localRequestId,
        statusCode: 0,
        responseTime: 0
      })
      pushNewRequest(buildSummary(meta, meta.localRequestId, 0, 0, undefined, false), 'pending')
    },

    appendEvent,

    // 上游响应头到达：回写真实 status_code，状态仍 pending（UI 保留 spinner）
    headers({ statusCode, headers }): void {
      getDatabase().prepare(
        'UPDATE requests SET status_code = ?, response_headers = ? WHERE request_id = ? AND session_id = ?'
      ).run(
        statusCode,
        headers ? JSON.stringify(headers) : null,
        meta.localRequestId,
        meta.sessionId
      )

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
      const db = getDatabase()

      if (finalId !== meta.localRequestId) {
        const replace = db.transaction(() => {
          // id > startEventRowId：只迁本 recorder 创建后写入的事件，
          // 不迁同 localRequestId 的历史残留事件
          db.prepare(
            'UPDATE response_events SET request_id = ? WHERE request_id = ? AND session_id = ? AND id > ?'
          ).run(finalId, meta.localRequestId, meta.sessionId, startEventRowId)
          writeCompletedRow({
            meta, requestId: finalId, statusCode, responseTime, headers, usage, completedAt
          })
          db.prepare(
            'DELETE FROM requests WHERE request_id = ? AND session_id = ?'
          ).run(meta.localRequestId, meta.sessionId)
        })
        replace()
      } else {
        writeCompletedRow({
          meta, requestId: finalId, statusCode, responseTime, headers, usage, completedAt
        })
      }

      pushNewRequest(
        buildSummary(meta, finalId, statusCode, responseTime, usage, finalId !== meta.localRequestId),
        'completed'
      )
    },

    // 流被截断/挂死：保留真实 status_code，通过 closed_at + error 标记中断；
    // 同时通过定向 SQL（锚点事件 + 尾部事件）重建 usage 并按字段回填 token
    interrupt({ statusCode, error }): void {
      flushRemaining()
      const db = getDatabase()
      const responseTime = Date.now() - startTime
      const closedAt = new Date().toISOString()

      db.prepare(
        'UPDATE requests SET status_code = ?, response_time = ?, closed_at = ?, error = ? WHERE request_id = ? AND session_id = ?'
      ).run(statusCode, responseTime, closedAt, error, meta.localRequestId, meta.sessionId)

      const events = loadTargetedEvents(db, meta.localRequestId, meta.sessionId)
      const usage = reconstructUsageFromEvents(events)
      if (usage) {
        fillTokenColumns(db, meta.localRequestId, meta.sessionId, usage)
      }

      pushNewRequest(
        buildSummary(meta, meta.localRequestId, statusCode, responseTime, usage, false, closedAt),
        'completed'
      )
    },

    fail({ statusCode, error }): void {
      const responseTime = Date.now() - startTime
      const closedAt = new Date().toISOString()

      getDatabase().prepare(
        'UPDATE requests SET status_code = ?, response_time = ?, closed_at = ?, error = ? WHERE request_id = ? AND session_id = ?'
      ).run(statusCode, responseTime, closedAt, error, meta.localRequestId, meta.sessionId)

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
    const batch: EventEntry[] = events.map((e: any, i: number) => ({
      index: i,
      type: e?.type,
      data: e
    }))
    flushEventBatch(meta.sessionId, meta.localRequestId, batch, 0)
  }

  const usage = extractUsage(events)
  const completedAt = new Date().toISOString()

  writeCompletedRow({
    meta,
    requestId: meta.localRequestId,
    statusCode: meta.response.statusCode,
    responseTime: 0,
    headers: meta.response.headers,
    usage,
    completedAt
  })

  pushNewRequest(
    buildSummary(meta, meta.localRequestId, meta.response.statusCode, 0, usage, false),
    'completed'
  )
}

// Load single request by compositeId (sessionId:requestId)
export async function loadRequestDB(compositeId: string): Promise<LoadedRequest> {
  const db = initDatabase()

  const colonIndex = compositeId.indexOf(':')
  if (colonIndex === -1) {
    throw new Error(`Invalid compositeId format: ${compositeId}`)
  }

  const sessionId = compositeId.slice(0, colonIndex)
  const requestId = compositeId.slice(colonIndex + 1)

  const row = db.prepare(`
    SELECT * FROM requests WHERE request_id = ? AND session_id = ?
  `).get(requestId, sessionId) as any

  if (!row) {
    throw new Error(`Request not found: ${compositeId}`)
  }

  // Load events from separate table; fallback to old JSON column for historical data
  const eventRows = db.prepare(`
    SELECT event_index, event_type, event_data FROM response_events
    WHERE request_id = ? AND session_id = ?
    ORDER BY event_index ASC
  `).all(requestId, sessionId) as any[]

  let events: any[]
  if (eventRows.length > 0) {
    events = eventRows.map(r => {
      try { return JSON.parse(r.event_data) } catch { return { raw: r.event_data } }
    })
  } else if (row.response_events) {
    // Fallback: historical data stored events in the requests.response_events JSON column
    try { events = JSON.parse(row.response_events) } catch { events = [] }
  } else {
    events = []
  }

  return {
    requestId: row.request_id,
    sessionId: row.session_id,
    timestamp: row.timestamp,
    apiKey: row.api_key,
    proxyApiKey: row.proxy_api_key,
    baseUrl: row.base_url,
    model: row.model,
    machineId: row.machine_id,
    request: {
      method: row.method,
      path: row.path,
      headers: row.request_headers ? JSON.parse(row.request_headers) : {},
      body: row.request_body ? JSON.parse(row.request_body) : undefined
    },
    response: {
      statusCode: row.status_code,
      headers: row.response_headers ? JSON.parse(row.response_headers) : undefined,
      events: events.length > 0 ? events : undefined,
      completedAt: row.completed_at,
      closedAt: row.closed_at,
      error: row.error
    }
  }
}

// List requests with cursor pagination (summary, sorted by timestamp desc)
export async function listRequestDB(
  limit: number = 1000,
  before?: string
): Promise<{ requests: RequestSummary[]; hasMore: boolean }> {
  const db = initDatabase()

  const whereClause = before ? 'WHERE timestamp < ?' : ''
  const params = before ? [before, limit + 1] : [limit + 1]

  const rows = db.prepare(`
    SELECT
      request_id, session_id, timestamp, method, path, status_code, response_time,
      api_key, proxy_api_key, base_url, model, machine_id, user_agent,
      input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens, closed_at, error
    FROM requests
    ${whereClause}
    ORDER BY timestamp DESC
    LIMIT ?
  `).all(...params) as any[]

  const hasMore = rows.length > limit
  const actualRows = hasMore ? rows.slice(0, -1) : rows

  return {
    requests: actualRows.map(row => ({
      requestId: row.request_id,
      sessionId: row.session_id,
      compositeId: `${row.session_id}:${row.request_id}`,
      timestamp: row.timestamp,
      method: row.method,
      path: row.path,
      statusCode: row.status_code,
      responseTime: row.response_time,
      apiKey: row.api_key,
      proxyApiKey: row.proxy_api_key,
      baseUrl: row.base_url,
      model: row.model,
      machineId: row.machine_id,
      userAgent: row.user_agent,
      usage: row.input_tokens || row.output_tokens ? {
        input_tokens: row.input_tokens,
        output_tokens: row.output_tokens,
        cache_read_input_tokens: row.cache_read_tokens,
        cache_creation_input_tokens: row.cache_creation_tokens
      } : undefined,
      closedAt: row.closed_at || undefined,
      error: row.error || undefined
    })),
    hasMore
  }
}

// Clean old requests (time window based, configurable)
// daysToKeep <= 0 means no cleanup (keep all data)
export async function cleanOldRequestsDB(daysToKeep = 7): Promise<void> {
  if (daysToKeep <= 0) {
    // No cleanup, keep all historical data
    return
  }

  const db = initDatabase()

  const cutoff = new Date(Date.now() - daysToKeep * 86400000).toISOString()

  // Delete response_events first (foreign data), then requests
  db.prepare(`DELETE FROM response_events WHERE request_id IN (SELECT request_id FROM requests WHERE timestamp < ?)`).run(cutoff)
  db.prepare(`DELETE FROM requests WHERE timestamp < ?`).run(cutoff)
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

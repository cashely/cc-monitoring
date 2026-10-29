import { initDatabase, getDatabase } from './db.js'
import { parseUpstreamEvents } from './inject-loop.js'

export interface RequestData {
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
    events?: any[]  // Only used for initial pending save (empty array) and JSON responses
    completedAt?: string
    closedAt?: string
    error?: string
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
}

export function extractTokenUsage(events: any[] | undefined): TokenUsage | undefined {
  if (!events) return undefined
  const messageDelta = events.find((e: any) => e?.type === 'message_delta')
  return messageDelta?.usage
}

// --- SSE Event Batch Writer (incremental DB writes during streaming) ---

export const EVENT_BATCH_SIZE = 10

// Cached prepared statements for batch writes
let insertEventStmt: import('better-sqlite3').Statement | null = null
let deleteRequestStmt: import('better-sqlite3').Statement | null = null
let cachedDbInstance: import('better-sqlite3').Database | null = null

// Invalidate cached stmts when DB instance changes (tests create fresh DB per suite)
function ensureStmtCacheValid(db: import('better-sqlite3').Database): void {
  if (db !== cachedDbInstance) {
    insertEventStmt = null
    deleteRequestStmt = null
    cachedDbInstance = db
  }
}

/**
 * Flush a batch of SSE events to the response_events table.
 * Called during streaming every ~10 events to avoid in-memory accumulation.
 */
export function flushEventBatch(
  sessionId: string,
  requestId: string,
  batch: Array<{ index: number; type?: string; data: unknown }>,
  startIndex: number
): void {
  const db = getDatabase()
  ensureStmtCacheValid(db)
  if (!insertEventStmt) {
    insertEventStmt = db.prepare(
      'INSERT INTO response_events (request_id, session_id, event_index, event_type, event_data) VALUES (?, ?, ?, ?, ?)'
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

/**
 * Delete response_events rows for a request (used when cloudRequestId differs from local requestId).
 */
export function deleteResponseEvents(requestId: string, sessionId: string): void {
  const db = getDatabase()
  db.prepare('DELETE FROM response_events WHERE request_id = ? AND session_id = ?').run(requestId, sessionId)
}

// --- Request DB Operations ---

// Save request to SQLite database
export async function saveRequestDB(
  sessionId: string,
  requestId: string,
  data: RequestData
): Promise<void> {
  const db = initDatabase()

  const events = data.response?.events
  const usage = events ? extractTokenUsage(events) : undefined

  // For JSON responses (non-streaming), events are still in the array — flush them first
  if (events && events.length > 0) {
    const batch = events.map((e: any, i: number) => ({
      index: i,
      type: e?.type ?? undefined,
      data: e
    }))
    flushEventBatch(sessionId, requestId, batch, 0)
  }

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
    requestId,
    sessionId,
    data.timestamp,
    data.request.method,
    data.request.path,
    data.response?.statusCode ?? 0,
    data.response?.completedAt && data.timestamp
      ? Math.round(new Date(data.response.completedAt).getTime() - new Date(data.timestamp).getTime())
      : 0,
    data.apiKey || null,
    data.proxyApiKey || null,
    data.baseUrl || null,
    data.model || null,
    data.machineId || null,
    data.request.headers['user-agent'] || null,
    usage?.input_tokens || null,
    usage?.output_tokens || null,
    usage?.cache_read_input_tokens || null,
    usage?.cache_creation_input_tokens || null,
    JSON.stringify(data.request.headers),
    data.request.body ? JSON.stringify(data.request.body) : null,
    data.response?.headers ? JSON.stringify(data.response.headers) : null,
    null,  // response_events now stored in separate table
    data.response?.completedAt || null,
    data.response?.closedAt || null,
    data.response?.error || null
  )
}

// Update token columns for a request (streaming: usage extracted from tailBuffer after save)
export function updateRequestTokens(
  requestId: string,
  sessionId: string,
  usage: TokenUsage | undefined
): void {
  const db = getDatabase()
  db.prepare(
    'UPDATE requests SET input_tokens = ?, output_tokens = ?, cache_read_tokens = ?, cache_creation_tokens = ? WHERE request_id = ? AND session_id = ?'
  ).run(
    usage?.input_tokens || null,
    usage?.output_tokens || null,
    usage?.cache_read_input_tokens || null,
    usage?.cache_creation_input_tokens || null,
    requestId,
    sessionId
  )
}

// Delete a request row by requestId + sessionId (for pending → completed replacement)
export function deleteRequestRow(requestId: string, sessionId: string): void {
  const db = getDatabase()
  ensureStmtCacheValid(db)
  if (!deleteRequestStmt) {
    deleteRequestStmt = db.prepare('DELETE FROM requests WHERE request_id = ? AND session_id = ?')
  }
  deleteRequestStmt.run(requestId, sessionId)
}

// Load single request by compositeId (sessionId:requestId)
export async function loadRequestDB(compositeId: string): Promise<RequestData> {
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
      input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens
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
      } : undefined
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

// Check if a sessionId exists in the database
export function sessionIdExists(sessionId: string): boolean {
  const db = initDatabase()
  const row = db.prepare(`
    SELECT 1 FROM requests WHERE session_id = ? LIMIT 1
  `).get(sessionId)
  return !!row
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

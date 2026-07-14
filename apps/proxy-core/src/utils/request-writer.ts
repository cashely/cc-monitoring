import { initDatabase, getDatabase } from './db.js'

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
    events?: any[]
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
  usage?: TokenUsage
}

export function extractTokenUsage(events: any[] | undefined): TokenUsage | undefined {
  if (!events) return undefined
  const messageDelta = events.find((e: any) => e?.type === 'message_delta')
  return messageDelta?.usage
}

// Save request to SQLite database
export async function saveRequestDB(
  sessionId: string,
  requestId: string,
  data: RequestData
): Promise<void> {
  const db = initDatabase()

  const usage = extractTokenUsage(data.response?.events)

  const stmt = db.prepare(`
    INSERT OR REPLACE INTO requests (
      request_id, session_id, timestamp, method, path, status_code, response_time,
      api_key, proxy_api_key, base_url, model, machine_id,
      input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens,
      request_headers, request_body, response_headers, response_events,
      completed_at, closed_at, error
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
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
    usage?.input_tokens || null,
    usage?.output_tokens || null,
    usage?.cache_read_input_tokens || null,
    usage?.cache_creation_input_tokens || null,
    JSON.stringify(data.request.headers),
    data.request.body ? JSON.stringify(data.request.body) : null,
    data.response?.headers ? JSON.stringify(data.response.headers) : null,
    data.response?.events ? JSON.stringify(data.response?.events) : null,
    data.response?.completedAt || null,
    data.response?.closedAt || null,
    data.response?.error || null
  )
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
      events: row.response_events ? JSON.parse(row.response_events) : undefined,
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
      api_key, proxy_api_key, base_url, model, machine_id,
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

  db.prepare(`DELETE FROM requests WHERE timestamp < ?`).run(cutoff)
}
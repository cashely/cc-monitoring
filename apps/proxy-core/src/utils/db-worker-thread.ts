import { parentPort, workerData } from 'node:worker_threads'
import Database from 'better-sqlite3'
import { reconstructUsageFromEvents } from './request-writer.js'

// worker 线程：独占一个 better-sqlite3 连接，消息严格按到达顺序处理，
// 成功/失败都回 postMessage。连接必须在本线程内创建，不能跨线程传递。

interface RequestRowMessage {
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

interface WorkerMessage {
  id: number
  action: string
  payload?: any
}

const db = new Database(workerData.dbPath as string)
db.pragma('journal_mode = WAL')
db.pragma('synchronous = NORMAL')

// --- Prepared statements ---

const insertEventStmt = db.prepare(
  'INSERT OR IGNORE INTO response_events (request_id, session_id, event_index, event_type, event_data) VALUES (?, ?, ?, ?, ?)'
)

const maxEventIdStmt = db.prepare('SELECT MAX(id) AS m FROM response_events')

const insertRequestStmt = db.prepare(`
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

const updateHeadersStmt = db.prepare(
  'UPDATE requests SET status_code = ?, response_headers = ? WHERE request_id = ? AND session_id = ?'
)

const migrateEventsStmt = db.prepare(
  'UPDATE response_events SET request_id = ? WHERE request_id = ? AND session_id = ? AND id > ?'
)

const deleteRequestStmt = db.prepare(
  'DELETE FROM requests WHERE request_id = ? AND session_id = ?'
)

const interruptStmt = db.prepare(
  'UPDATE requests SET status_code = ?, response_time = ?, closed_at = ?, error = ? WHERE request_id = ? AND session_id = ?'
)

// --- requests 行写入 ---

function insertRequestRow(row: RequestRowMessage): void {
  insertRequestStmt.run(
    row.requestId,
    row.sessionId,
    row.timestamp,
    row.method,
    row.path,
    row.statusCode,
    row.responseTime,
    row.apiKey ?? null,
    row.proxyApiKey ?? null,
    row.baseUrl ?? null,
    row.model ?? null,
    row.machineId ?? null,
    row.userAgent ?? null,
    row.inputTokens ?? null,
    row.outputTokens ?? null,
    row.cacheReadTokens ?? null,
    row.cacheCreationTokens ?? null,
    JSON.stringify(row.requestHeaders ?? {}),
    row.requestBody !== undefined ? JSON.stringify(row.requestBody) : null,
    row.responseHeaders ? JSON.stringify(row.responseHeaders) : null,
    null,  // response_events 已拆到独立表
    row.completedAt ?? null,
    row.closedAt ?? null,
    row.error ?? null
  )
}

// 定向加载重建所需事件（锚点事件 + 尾部 10 条），与主线程 request-writer 同口径
function loadTargetedEvents(requestId: string, sessionId: string): any[] {
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
  for (const r of [...anchorRows, ...tailRows]) {
    if (seen.has(r.event_data)) continue
    seen.add(r.event_data)
    try {
      events.push(JSON.parse(r.event_data))
    } catch {
      // 忽略损坏行
    }
  }
  return events
}

type TokenColumn = 'input_tokens' | 'output_tokens' | 'cache_read_tokens' | 'cache_creation_tokens'

// --- Action handlers ---

function recorderStart(): { startEventRowId: number } {
  const row = maxEventIdStmt.get() as { m: number | null }
  return { startEventRowId: row.m ?? 0 }
}

function eventsInsertBatch(rows: {
  requestId: string
  sessionId: string
  index: number
  type?: string
  data: unknown
}[]): void {
  const tx = db.transaction(() => {
    for (const r of rows) {
      insertEventStmt.run(r.requestId, r.sessionId, r.index, r.type ?? null, JSON.stringify(r.data))
    }
  })
  tx()
}

function requestsComplete(payload: {
  row: RequestRowMessage
  localId: string
  sessionId: string
  startEventRowId: number
}): void {
  const { row, localId, sessionId, startEventRowId } = payload
  if (row.requestId !== localId) {
    // finalId≠localId：单事务迁移本 recorder 生命周期内（id>startEventRowId）
    // 的事件 → 写终态行 → 删 localId 占位行
    const tx = db.transaction(() => {
      migrateEventsStmt.run(row.requestId, localId, sessionId, startEventRowId)
      insertRequestRow(row)
      deleteRequestStmt.run(localId, sessionId)
    })
    tx()
  } else {
    insertRequestRow(row)
  }
}

function requestsInterrupt(payload: {
  requestId: string
  sessionId: string
  statusCode: number
  responseTime: number
  closedAt: string
  error: string
}): { usage?: NonNullable<ReturnType<typeof reconstructUsageFromEvents>> } {
  interruptStmt.run(
    payload.statusCode,
    payload.responseTime,
    payload.closedAt,
    payload.error,
    payload.requestId,
    payload.sessionId
  )

  // 移植主线程 interrupt：定向 SQL 重建 usage 并按字段回填 token
  const events = loadTargetedEvents(payload.requestId, payload.sessionId)
  const usage = reconstructUsageFromEvents(events)
  if (usage) {
    const current = db.prepare(`
      SELECT input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens
      FROM requests WHERE request_id = ? AND session_id = ?
    `).get(payload.requestId, payload.sessionId) as Record<TokenColumn, number | null> | undefined
    if (current) {
      const pairs: [TokenColumn, number | undefined][] = [
        ['input_tokens', usage.input_tokens],
        ['output_tokens', usage.output_tokens],
        ['cache_read_tokens', usage.cache_read_input_tokens],
        ['cache_creation_tokens', usage.cache_creation_input_tokens]
      ]
      const updatable = pairs.filter(([col, v]) => current[col] === null && typeof v === 'number')
      if (updatable.length > 0) {
        const setSql = updatable.map(([col]) => `${col} = ?`).join(', ')
        db.prepare(`UPDATE requests SET ${setSql} WHERE request_id = ? AND session_id = ?`)
          .run(...updatable.map(([, v]) => v as number), payload.requestId, payload.sessionId)
      }
    }
  }

  return { usage }
}

function requestsCleanup(cutoffIso: string): void {
  // 移植 cleanOldRequestsDB：单 cutoff（events 与 requests 同源），临时表收集
  // 待删 request_id，分批（每批 5000、独立事务）删除，末尾 incremental_vacuum。
  const batchSize = 5000

  db.exec('DROP TABLE IF EXISTS temp.old_request_ids')
  db.exec('CREATE TEMP TABLE old_request_ids (request_id TEXT PRIMARY KEY)')
  db.prepare('INSERT INTO old_request_ids SELECT request_id FROM requests WHERE timestamp < ?').run(cutoffIso)

  const deleteEventsBatch = db.prepare(`
    DELETE FROM response_events
    WHERE id IN (
      SELECT re.id FROM response_events re
      JOIN old_request_ids o ON re.request_id = o.request_id
      LIMIT ?
    )
  `)
  const runEventsBatch = db.transaction((): number => deleteEventsBatch.run(batchSize).changes)
  while (true) {
    if (runEventsBatch() === 0) break
  }

  const deleteRequestsBatch = db.prepare(`
    DELETE FROM requests
    WHERE request_id IN (SELECT request_id FROM old_request_ids ORDER BY request_id LIMIT ?)
  `)
  const pruneOldIds = db.prepare(`
    DELETE FROM old_request_ids
    WHERE request_id IN (SELECT request_id FROM old_request_ids ORDER BY request_id LIMIT ?)
  `)
  const runRequestsBatch = db.transaction((): number => {
    const info = deleteRequestsBatch.run(batchSize)
    pruneOldIds.run(batchSize)
    return info.changes
  })
  while (true) {
    if (runRequestsBatch() === 0) break
  }

  db.exec('DROP TABLE IF EXISTS temp.old_request_ids')
  db.pragma('incremental_vacuum')
}

function requestsGet(compositeId: string): any {
  const colonIndex = compositeId.indexOf(':')
  if (colonIndex === -1) {
    throw new Error(`Invalid compositeId format: ${compositeId}`)
  }
  const sessionId = compositeId.slice(0, colonIndex)
  const requestId = compositeId.slice(colonIndex + 1)

  const row = db.prepare(
    'SELECT * FROM requests WHERE request_id = ? AND session_id = ?'
  ).get(requestId, sessionId) as any
  if (!row) {
    throw new Error(`Request not found: ${compositeId}`)
  }

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
    // 兼容历史数据：旧版本 events 存在 requests.response_events JSON 列
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

function requestsList(payload: { limit: number; before?: string }): { requests: any[]; hasMore: boolean } {
  const limit = payload.limit
  const whereClause = payload.before ? 'WHERE timestamp < ?' : ''
  const params = payload.before ? [payload.before, limit + 1] : [limit + 1]

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

// --- stats handlers（通用原语，不含策略调用）---

function statsAggregateHourKeys(keys: string[]): void {
  // 单事务：逐个 key DELETE 旧行 → 按该小时 UTC 上下界从 requests 聚合重插
  const deleteKey = db.prepare("DELETE FROM stats WHERE period = 'hourly' AND period_key = ?")
  const aggregateHour = db.prepare(`
    INSERT INTO stats (
      period, period_key, input_tokens, output_tokens,
      cache_read_tokens, cache_creation_tokens, request_count, updated_at
    )
    SELECT 'hourly', ?,
      SUM(input_tokens), SUM(output_tokens), SUM(cache_read_tokens),
      SUM(cache_creation_tokens), COUNT(*), CURRENT_TIMESTAMP
    FROM requests
    WHERE timestamp >= ? AND timestamp < ?
    HAVING COUNT(*) > 0
  `)

  const tx = db.transaction(() => {
    for (const key of keys) {
      const m = /^(\d{4})-(\d{2})-(\d{2})-(\d{2})$/.exec(key)
      if (!m) throw new Error(`Invalid hour key: ${key}`)
      const startIso = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:00:00.000Z`
      const endIso = new Date(new Date(startIso).getTime() + 3600000).toISOString()
      deleteKey.run(key)
      aggregateHour.run(key, startIso, endIso)
    }
  })
  tx()
}

function statsDeleteBefore(key: string): void {
  db.prepare("DELETE FROM stats WHERE period = 'hourly' AND period_key < ?").run(key)
}

function statsGet(sinceKey?: string): any {
  let hourlyRows: any[]
  if (sinceKey) {
    hourlyRows = db.prepare(`
      SELECT * FROM stats WHERE period = 'hourly' AND period_key >= ? ORDER BY period_key ASC
    `).all(sinceKey) as any[]
  } else {
    hourlyRows = db.prepare(`
      SELECT * FROM stats WHERE period = 'hourly' ORDER BY period_key ASC LIMIT 720
    `).all() as any[]
  }

  const lastUpdatedRow = db.prepare('SELECT MAX(updated_at) AS last_updated FROM stats').get() as any

  const hourly: Record<string, any> = {}
  for (const row of hourlyRows) {
    hourly[row.period_key] = {
      input_tokens: row.input_tokens,
      output_tokens: row.output_tokens,
      cache_read_tokens: row.cache_read_tokens,
      cache_creation_tokens: row.cache_creation_tokens,
      request_count: row.request_count
    }
  }

  return {
    hourly,
    lastUpdated: lastUpdatedRow?.last_updated || null
  }
}

function statsToday(since: string): any {
  const totalRow = db.prepare(`
    SELECT
      SUM(input_tokens) as input_tokens,
      SUM(output_tokens) as output_tokens,
      SUM(cache_read_tokens) as cache_read_tokens,
      SUM(cache_creation_tokens) as cache_creation_tokens,
      COUNT(*) as request_count
    FROM requests
    WHERE timestamp >= ?
  `).get(since) as any

  const modelRows = db.prepare(`
    SELECT model, COUNT(*) as count
    FROM requests
    WHERE timestamp >= ?
      AND model IS NOT NULL AND model != ''
    GROUP BY model
    ORDER BY count DESC
  `).all(since) as any[]

  const models: Record<string, number> = {}
  for (const row of modelRows) {
    models[row.model] = row.count
  }

  return {
    input_tokens: totalRow?.input_tokens || 0,
    output_tokens: totalRow?.output_tokens || 0,
    cache_read_tokens: totalRow?.cache_read_tokens || 0,
    request_count: totalRow?.request_count || 0,
    models
  }
}

// --- 消息分发：严格按到达顺序，成功/失败都回复 ---

async function runAction(action: string, payload: any): Promise<any> {
  switch (action) {
    case 'recorder.start':
      return recorderStart()
    case 'events.insertBatch':
      return eventsInsertBatch(payload as never[])
    case 'requests.insertPending':
      insertRequestRow(payload as RequestRowMessage)
      return
    case 'requests.updateHeaders': {
      const p = payload as { requestId: string; sessionId: string; statusCode: number; headers?: Record<string, string> }
      updateHeadersStmt.run(p.statusCode, p.headers ? JSON.stringify(p.headers) : null, p.requestId, p.sessionId)
      return
    }
    case 'requests.complete':
      return requestsComplete(payload)
    case 'requests.interrupt':
      return requestsInterrupt(payload)
    case 'requests.fail': {
      // 移植现有 fail 逻辑：只 UPDATE 状态/error，不重建 usage
      const p = payload as {
        requestId: string
        sessionId: string
        statusCode: number
        responseTime: number
        closedAt: string
        error: string
      }
      interruptStmt.run(p.statusCode, p.responseTime, p.closedAt, p.error, p.requestId, p.sessionId)
      return
    }
    case 'requests.cleanup':
      return requestsCleanup((payload as { cutoffIso: string }).cutoffIso)
    case 'requests.get':
      return requestsGet((payload as { compositeId: string }).compositeId)
    case 'requests.list':
      return requestsList(payload)
    case 'stats.aggregateHourKeys':
      return statsAggregateHourKeys((payload as { keys: string[] }).keys)
    case 'stats.deleteBefore':
      return statsDeleteBefore((payload as { key: string }).key)
    case 'stats.get':
      return statsGet((payload as { sinceKey?: string })?.sinceKey)
    case 'stats.today':
      return statsToday((payload as { since: string }).since)
    case 'db.checkpoint':
      db.pragma('wal_checkpoint(TRUNCATE)')
      return
    default:
      throw new Error(`Unknown db worker action: ${action}`)
  }
}

async function handleMessage(msg: WorkerMessage): Promise<void> {
  if (msg.action === 'meta.stop') {
    db.close()
    setTimeout(() => process.exit(0), 0)
    return
  }
  try {
    const value = await runAction(msg.action, msg.payload)
    parentPort!.postMessage({ id: msg.id, ok: true, value })
  } catch (err) {
    parentPort!.postMessage({
      id: msg.id,
      ok: false,
      error: err instanceof Error ? err.message : String(err)
    })
  }
}

let queue: Promise<void> = Promise.resolve()
parentPort!.on('message', (msg: WorkerMessage) => {
  queue = queue.then(() => handleMessage(msg))
})

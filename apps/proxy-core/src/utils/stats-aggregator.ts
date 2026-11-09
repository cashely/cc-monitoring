import { initDatabase } from './db.js'

export interface HourlyEntry {
  input_tokens: number
  output_tokens: number
  cache_read_tokens: number
  cache_creation_tokens: number
  request_count: number
}

export interface StatsData {
  hourly: Record<string, HourlyEntry>
  lastUpdated: string | null
}

export interface TodayStats {
  input_tokens: number
  output_tokens: number
  cache_read_tokens: number
  request_count: number
  models: Record<string, number>
}

// 共用 token 聚合列：小时聚合与今日 totals 同口径，避免列漂移
const TOKEN_AGG_COLUMNS = `
  SUM(input_tokens) as input_tokens,
  SUM(output_tokens) as output_tokens,
  SUM(cache_read_tokens) as cache_read_tokens,
  SUM(cache_creation_tokens) as cache_creation_tokens,
  COUNT(*) as request_count
`

// Build the UTC hourly key ('YYYY-MM-DD-HH') used as stats.period_key
function toHourKey(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}-${String(date.getUTCHours()).padStart(2, '0')}`
}

// Aggregate stats from requests table (called periodically)
// Only stores hourly (UTC) entries — daily aggregation is done on the frontend
// using the user's local timezone.
// maxDays: hourly retention window in days. A positive integer shrinks the
// window (capped at 30); undefined / <=0 falls back to the default 30 days.
export function aggregateStats(maxDays?: number): void {
  const db = initDatabase()

  const now = new Date()
  const nowIso = now.toISOString()
  // windowDays days of hourly data (30 days = 720 entries)
  const windowDays = Number.isInteger(maxDays) && (maxDays as number) > 0
    ? Math.min(30, maxDays as number)
    : 30
  const hourlyCutoff = new Date(now.getTime() - windowDays * 86400000).toISOString()

  // Aggregate hourly stats using SQLite's built-in strftime (UTC)
  const hourlyRows = db.prepare(`
    SELECT
      strftime('%Y-%m-%d-%H', timestamp) as hour,
      ${TOKEN_AGG_COLUMNS}
    FROM requests
    WHERE timestamp >= ?
    GROUP BY hour
  `).all(hourlyCutoff) as any[]

  // Recompute the whole window atomically: drop every hourly snapshot inside
  // the window first (source rows may already have been deleted by cleanup, so
  // an upsert-only pass would leave stale snapshots frozen forever), then
  // re-insert from the requests table.
  // Cutoff key uses UTC methods to match the UTC keys stored in the DB.
  // The two deletes (< key / >= key) together clear every hourly row.
  const cutoffKey = toHourKey(new Date(hourlyCutoff))
  const deleteWindow = db.prepare(`DELETE FROM stats WHERE period = 'hourly' AND period_key >= ?`)

  // Upsert hourly stats
  const upsertHourly = db.prepare(`
    INSERT OR REPLACE INTO stats (
      period, period_key, input_tokens, output_tokens,
      cache_read_tokens, cache_creation_tokens, request_count, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `)

  // Clean hourly entries outside the recomputation window
  const deleteOldKeys = db.prepare(`DELETE FROM stats WHERE period = 'hourly' AND period_key < ?`)

  // Clean ALL daily entries (legacy data from old +8h approach)
  const deleteDaily = db.prepare(`DELETE FROM stats WHERE period = 'daily'`)

  const recompute = db.transaction(() => {
    deleteWindow.run(cutoffKey)
    for (const row of hourlyRows) {
      upsertHourly.run(
        'hourly',
        row.hour,
        row.input_tokens || 0,
        row.output_tokens || 0,
        row.cache_read_tokens || 0,
        row.cache_creation_tokens || 0,
        row.request_count,
        nowIso
      )
    }
    deleteOldKeys.run(cutoffKey)
    deleteDaily.run()
  })
  recompute()

  // WAL checkpoint to keep WAL file size bounded
  db.pragma('wal_checkpoint(TRUNCATE)')
}

// Get aggregated stats for UI
export function getStatsData(since?: string): StatsData {
  const db = initDatabase()

  let hourlyRows: any[]
  if (since) {
    // Convert since (ISO UTC) to UTC hourly key format for filtering
    const sinceKey = toHourKey(new Date(since))
    hourlyRows = db.prepare(`
      SELECT * FROM stats WHERE period = 'hourly' AND period_key >= ? ORDER BY period_key ASC
    `).all(sinceKey) as any[]
  } else {
    hourlyRows = db.prepare(`
      SELECT * FROM stats WHERE period = 'hourly' ORDER BY period_key ASC LIMIT 720
    `).all() as any[]
  }

  const lastUpdatedRow = db.prepare(`
    SELECT MAX(updated_at) as last_updated FROM stats
  `).get() as any

  const hourly: Record<string, HourlyEntry> = {}
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

// Get today's real-time stats directly from requests table (no aggregation delay).
// `since` is the ISO timestamp of local midnight (computed by the caller/frontend),
// so the "today" boundary follows the user's timezone instead of a hardcoded offset.
export function getTodayStats(since: string): TodayStats {
  const db = initDatabase()

  // Totals: SUM tokens + COUNT requests since local midnight
  // 多选的 cache_creation_tokens 在返回映射时忽略
  const totalRow = db.prepare(`
    SELECT ${TOKEN_AGG_COLUMNS}
    FROM requests
    WHERE timestamp >= ?
  `).get(since) as any

  // Per-model usage count since local midnight
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

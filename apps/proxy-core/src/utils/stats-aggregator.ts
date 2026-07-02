import { initDatabase, getDatabase } from './db.js'

export interface StatsData {
  hourly: Record<string, any>
  daily: Record<string, any>
  lastUpdated: string | null
}

// Aggregate stats from requests table (called periodically)
export function aggregateStats(): void {
  const db = initDatabase()

  const now = new Date()
  const hourlyCutoff = new Date(now.getTime() - 24 * 3600000).toISOString()  // Last 24 hours
  const dailyCutoff = new Date(now.getTime() - 30 * 86400000).toISOString() // Last 30 days

  // Aggregate hourly stats (using UTC, frontend will format with local timezone)
  const hourlyRows = db.prepare(`
    SELECT
      strftime('%Y-%m-%d-%H', timestamp) as hour,
      SUM(input_tokens) as input_tokens,
      SUM(output_tokens) as output_tokens,
      SUM(cache_read_tokens) as cache_read_tokens,
      SUM(cache_creation_tokens) as cache_creation_tokens,
      COUNT(*) as request_count
    FROM requests
    WHERE timestamp >= ?
    GROUP BY hour
  `).all(hourlyCutoff) as any[]

  // Upsert hourly stats
  const upsertHourly = db.prepare(`
    INSERT OR REPLACE INTO stats (
      period, period_key, input_tokens, output_tokens,
      cache_read_tokens, cache_creation_tokens, request_count, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
  `)

  for (const row of hourlyRows) {
    upsertHourly.run(
      'hourly',
      row.hour,
      row.input_tokens || 0,
      row.output_tokens || 0,
      row.cache_read_tokens || 0,
      row.cache_creation_tokens || 0,
      row.request_count
    )
  }

  // Aggregate daily stats (using local date UTC+8, frontend queries with local date)
  const dailyRows = db.prepare(`
    SELECT
      strftime('%Y-%m-%d', datetime(timestamp, '+8 hours')) as day,
      SUM(input_tokens) as input_tokens,
      SUM(output_tokens) as output_tokens,
      SUM(cache_read_tokens) as cache_read_tokens,
      SUM(cache_creation_tokens) as cache_creation_tokens,
      COUNT(*) as request_count
    FROM requests
    WHERE timestamp >= ?
    GROUP BY day
  `).all(dailyCutoff) as any[]

  // Upsert daily stats
  const upsertDaily = db.prepare(`
    INSERT OR REPLACE INTO stats (
      period, period_key, input_tokens, output_tokens,
      cache_read_tokens, cache_creation_tokens, request_count, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
  `)

  for (const row of dailyRows) {
    upsertDaily.run(
      'daily',
      row.day,
      row.input_tokens || 0,
      row.output_tokens || 0,
      row.cache_read_tokens || 0,
      row.cache_creation_tokens || 0,
      row.request_count
    )
  }

  // Clean old stats entries (hourly uses UTC, daily uses local date)
  db.prepare(`DELETE FROM stats WHERE period = 'hourly' AND period_key < ?`).run(
    strftime('%Y-%m-%d-%H', hourlyCutoff)
  )
  // Daily cutoff needs to be in local date (UTC+8)
  const dailyCutoffLocal = new Date(new Date(dailyCutoff).getTime() + 8 * 3600000)
  db.prepare(`DELETE FROM stats WHERE period = 'daily' AND period_key < ?`).run(
    strftime('%Y-%m-%d', dailyCutoffLocal)
  )
}

// Get aggregated stats for UI
export function getStatsData(): StatsData {
  const db = initDatabase()

  const hourlyRows = db.prepare(`
    SELECT * FROM stats WHERE period = 'hourly' ORDER BY period_key DESC LIMIT 24
  `).all() as any[]

  const dailyRows = db.prepare(`
    SELECT * FROM stats WHERE period = 'daily' ORDER BY period_key DESC LIMIT 30
  `).all() as any[]

  const lastUpdatedRow = db.prepare(`
    SELECT MAX(updated_at) as last_updated FROM stats
  `).get() as any

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

  const daily: Record<string, any> = {}
  for (const row of dailyRows) {
    daily[row.period_key] = {
      input_tokens: row.input_tokens,
      output_tokens: row.output_tokens,
      cache_read_tokens: row.cache_read_tokens,
      cache_creation_tokens: row.cache_creation_tokens,
      request_count: row.request_count
    }
  }

  return {
    hourly,
    daily,
    lastUpdated: lastUpdatedRow?.last_updated || null
  }
}

// Helper function (strftime for JS)
function strftime(format: string, date: string | Date): string {
  const d = typeof date === 'string' ? new Date(date) : date

  if (format === '%Y-%m-%d-%H') {
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}`
  }
  if (format === '%Y-%m-%d') {
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  }
  return ''
}

function pad(n: number): string {
  return n.toString().padStart(2, '0')
}
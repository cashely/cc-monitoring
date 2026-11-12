import { dbCall } from './db-worker-client.js'

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

// Build the UTC hourly key ('YYYY-MM-DD-HH') used as stats.period_key
function toHourKey(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}-${String(date.getUTCHours()).padStart(2, '0')}`
}

// Incremental aggregation into the persistent stats ledger (executed in the db
// worker). Only hourly (UTC) entries are stored — daily aggregation is done on
// the frontend using the user's local timezone.
//
// Only the current hour plus the previous 3 closed hours (4 buckets) are
// recomputed: DELETE each bucket then re-aggregate it from the requests table
// inside one transaction. Earlier buckets are frozen and never touched, so
// deleting raw requests does not erase historical stats.
//
// maxDays: raw requests retention (used by the cleanup path, not here — kept
// for signature compatibility).
// statsMaxDays: hourly ledger retention; a positive integer deletes buckets
// older than it; 0 / undefined keeps the ledger forever.
export async function aggregateStats(maxDays?: number, statsMaxDays?: number): Promise<void> {
  void maxDays

  const now = new Date()
  const keys: string[] = []
  for (let i = 0; i < 4; i++) {
    keys.push(toHourKey(new Date(now.getTime() - i * 3600000)))
  }
  await dbCall('stats.aggregateHourKeys', { keys })

  if (typeof statsMaxDays === 'number' && statsMaxDays > 0) {
    const cutoffKey = toHourKey(new Date(now.getTime() - statsMaxDays * 86400000))
    await dbCall('stats.deleteBefore', { key: cutoffKey })
  }
}

// Get aggregated stats for UI (read-only, no pre-read aggregation)
export async function getStatsData(since?: string): Promise<StatsData> {
  return dbCall<StatsData>('stats.get', {
    sinceKey: since ? toHourKey(new Date(since)) : undefined
  })
}

// Get today's real-time stats directly from requests table (no aggregation delay).
// `since` is the ISO timestamp of local midnight (computed by the caller/frontend),
// so the "today" boundary follows the user's timezone instead of a hardcoded offset.
export async function getTodayStats(since: string): Promise<TodayStats> {
  return dbCall<TodayStats>('stats.today', { since })
}

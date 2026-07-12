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

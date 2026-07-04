export interface TokenUsage {
  input_tokens: number
  output_tokens: number
  cache_read_input_tokens: number
}

export interface StatsData {
  hourly: Record<string, TokenUsage>
  daily: Record<string, TokenUsage>
  lastUpdated: string | null
}

export interface TodayStats {
  input_tokens: number
  output_tokens: number
  cache_read_tokens: number
  request_count: number
  models: Record<string, number>
}
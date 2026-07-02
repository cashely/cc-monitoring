export type ProcessStatus = 'online' | 'stopped' | 'errored' | 'launching'

export interface StatusApiResponse {
  status: ProcessStatus
  cpu: number
  memory: number
  uptime: number
  restarts: number
}

export interface StatusDataPoint {
  timestamp: number
  cpu: number
  memory: number
}

export interface StatusHistoryResponse {
  history: StatusDataPoint[]
}

export interface ValidationError {
  field: string
  message: string
}

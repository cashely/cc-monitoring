import { LogLevel } from './config'

export interface LogEntry {
  level: LogLevel
  time: string
  requestId: string
  method: HttpMethod
  path: string
  auth: AuthStatus
  msg: string
  error?: string
}

export type RequestSummaryType = 'request_started' | 'request_completed'

export interface RequestSummaryEntry {
  type: RequestSummaryType
  requestId: string
  method: string
  path: string
  level: LogLevel
  statusCode?: number
  responseTime?: number
  error?: string
}

export type LogItem = LogEntry | RequestSummaryEntry

export function isRequestSummary(entry: LogItem): entry is RequestSummaryEntry {
  return 'type' in entry && (entry.type === 'request_started' || entry.type === 'request_completed')
}

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH'
export type AuthStatus = 'present' | 'none'

import { LogLevel } from './config.js'

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

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH'
export type AuthStatus = 'present' | 'none'

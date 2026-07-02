import { ProcessStatus } from './pm2.js'
import { AppConfig } from './config.js'

export interface StatusApiResponse {
  status: ProcessStatus
  cpu: number
  memory: number
  uptime: number
  restarts: number
}

export interface ConfigApiResponse {
  config: AppConfig
}

export interface SaveConfigResponse {
  success: boolean
  errors?: ValidationError[]
}

export interface ValidationError {
  field: string
  message: string
}

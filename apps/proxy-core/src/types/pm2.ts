export interface Pm2ProcessStatus {
  name: string
  status: ProcessStatus
  cpu: number
  memory: number
  uptime: number
  restarts: number
}

export type ProcessStatus = 'online' | 'stopped' | 'errored' | 'launching'

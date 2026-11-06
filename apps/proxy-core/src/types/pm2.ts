export interface Pm2ProcessStatus {
  name: string
  status: 'online' | 'stopped' | 'errored' | 'launching'
  cpu: number
  memory: number
  uptime: number
  restarts: number
}

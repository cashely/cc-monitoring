export interface AppConfig {
  server: ServerConfig
  proxy: ProxyConfig
  logging: LogConfig
  auth?: AuthConfig
}

export interface AuthConfig {
  token: string
}

export interface ServerConfig {
  port: number
  host: string
}

export interface ProxyConfig {
  target: string
  changeOrigin: boolean
  rewritePrefix?: string
  apiKey?: string // Proxy API key (optional, replace client key if configured)
}

export interface LogConfig {
  level: LogLevel
  file: string
  maxSize?: string
  interval?: string
  compress?: boolean
}

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

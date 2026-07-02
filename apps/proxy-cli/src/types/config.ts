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
}

export interface LogConfig {
  level: LogLevel
  file: string
}

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export type TransportType = 'stdio' | 'sse' | 'streamable-http'

export interface McpServer {
  id: number
  name: string
  transport_type: TransportType
  command: string | null
  args: string | null       // JSON array string
  env: string | null        // JSON object string
  url: string | null
  headers: string | null    // JSON object string
  enabled: boolean
  created_at: string
  updated_at: string
}

export interface McpServerWithStatus extends McpServer {
  status: 'connected' | 'disconnected' | 'connecting' | 'not_connected' | 'disabled'
  toolCount: number
}

export interface McpServerInput {
  name: string
  transport_type: TransportType
  command?: string
  args?: string[]
  env?: Record<string, string>
  url?: string
  headers?: Record<string, string>
  enabled?: boolean
}

export interface McpTool {
  name: string
  description: string
  input_schema: Record<string, unknown>
}

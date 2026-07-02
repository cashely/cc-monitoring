export interface TokenUsage {
  input_tokens?: number
  output_tokens?: number
  cache_read_input_tokens?: number
  cache_creation_input_tokens?: number
}

export interface RequestSummary {
  requestId: string
  sessionId: string
  compositeId: string
  timestamp: string
  method: string
  path: string
  statusCode: number
  responseTime: number
  model?: string
  usage?: TokenUsage
}

export interface TokenUsage {
  input_tokens?: number
  output_tokens?: number
  cache_read_input_tokens?: number
  cache_creation_input_tokens?: number
}

export interface RequestDetails {
  requestId: string
  request: {
    method: string
    path: string
    headers: Record<string, string>
    body?: any
  }
  response?: {
    statusCode: number
    headers?: Record<string, string>
    events?: any[]
    completedAt?: string
    closedAt?: string
    error?: string
    usage?: TokenUsage
  }
}

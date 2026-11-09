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
  machineId?: string
  userAgent?: string
  baseUrl?: string
  usage?: TokenUsage
  status?: 'pending' | 'completed'
  pendingId?: string  // compositeId of the pending record to replace
  closedAt?: string   // 流中断时间（ISO），存在表示非正常结束
  error?: string      // 中断原因原文
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

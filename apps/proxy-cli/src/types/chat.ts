export interface TextBlock {
  type: 'text'
  id: string
  content: string
}

export interface ThinkingBlock {
  type: 'thinking'
  id: string
  content: string
}

export interface ToolBlock {
  type: 'tool'
  id: string
  toolCallId: string
  toolName: string
  args?: unknown
  result?: string
  isError?: boolean
  durationMs?: number
  status: 'running' | 'done'
}

export type ContentBlock = TextBlock | ThinkingBlock | ToolBlock

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  blocks: ContentBlock[]
  timestamp: number
}

export interface ChatConversation {
  sessionId: string
  messages: ChatMessage[]
}

export type ThinkingLevel = 'off' | 'minimal' | 'low' | 'medium' | 'high'

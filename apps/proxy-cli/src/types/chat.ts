export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: number
}

export interface ChatConversation {
  sessionId: string
  messages: ChatMessage[]
}

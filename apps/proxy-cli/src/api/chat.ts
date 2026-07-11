import type { ChatConversation } from '../types/chat'

const API_BASE = '/ui/api'

export const LOCALSTORAGE_KEY = 'cc-chat-conversations'

export function loadConversations(): ChatConversation[] {
  try {
    const raw = localStorage.getItem(LOCALSTORAGE_KEY)
    if (!raw) return []
    return JSON.parse(raw) as ChatConversation[]
  } catch {
    return []
  }
}

export function saveConversations(conversations: ChatConversation[]): void {
  localStorage.setItem(LOCALSTORAGE_KEY, JSON.stringify(conversations))
}

export interface SSEConnection {
  abortController: AbortController
  onSession: (sessionId: string) => void
  onData: (type: string, content: string) => void
  onError: (message: string) => void
  onDone: (code: number) => void
  abort: () => void
}

export function createChatConnection(prompt: string, sessionId?: string): SSEConnection {
  const abortController = new AbortController()

  const connection: SSEConnection = {
    abortController,
    onSession: () => {},
    onData: () => {},
    onError: () => {},
    onDone: () => {},
    abort: () => {
      abortController.abort()
    }
  }

  fetch(`${API_BASE}/exec`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      tool: 'claude',
      prompt,
      stream: true,
      sessionId
    }),
    signal: abortController.signal
  }).then(async (response) => {
    if (!response.ok) {
      const err = await response.json()
      connection.onError(err.error || `HTTP ${response.status}`)
      return
    }

    const reader = response.body?.getReader()
    if (!reader) {
      connection.onError('No response body')
      return
    }

    const decoder = new TextDecoder()
    let buffer = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })

      // SSE events are delimited by double newline (\n\n)
      const events = buffer.split('\n\n')
      buffer = events.pop() || ''  // last segment may be incomplete

      for (const eventStr of events) {
        if (!eventStr.trim()) continue

        let eventType = ''
        let eventData = ''

        for (const line of eventStr.split('\n')) {
          if (line.startsWith('event: ')) {
            eventType = line.slice(7)
          } else if (line.startsWith('data: ')) {
            eventData = line.slice(6)
          }
        }

        if (!eventType || !eventData) continue

        if (eventType === 'session') {
          connection.onSession(eventData)
        } else if (eventType === 'data') {
          try {
            const parsed = JSON.parse(eventData)
            connection.onData(parsed.type || 'stdout', parsed.content || '')
          } catch {
            connection.onData('stdout', eventData)
          }
        } else if (eventType === 'error') {
          try {
            const parsed = JSON.parse(eventData)
            connection.onError(parsed.message || eventData)
          } catch {
            connection.onError(eventData)
          }
        } else if (eventType === 'done') {
          try {
            const parsed = JSON.parse(eventData)
            connection.onDone(parsed.code ?? 0)
          } catch {
            connection.onDone(0)
          }
        }
      }
    }
  }).catch((err) => {
    if (err.name !== 'AbortError') {
      connection.onError(err.message || 'Connection failed')
    }
  })

  return connection
}

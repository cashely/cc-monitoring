import type { ChatConversation, ThinkingLevel } from '../types/chat'

const API_BASE = '/ui/api'

// v2：ChatMessage 从扁平 content 升级为 blocks 数组，旧结构不兼容，换新 key 清掉历史
export const LOCALSTORAGE_KEY = 'cc-chat-conversations-v2'

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
  // 把整个 parsed SSE 对象交给 hook，由 hook 按 type 分支累积 blocks
  onData: (type: string, data: any) => void
  onError: (message: string) => void
  onDone: (code: number) => void
  abort: () => void
}

export function createChatConnection(
  prompt: string,
  sessionId?: string,
  mode: 'chat' | 'learn' = 'chat',
  thinkingLevel?: ThinkingLevel,
  sourceType?: 'url' | 'file',
  label?: string
): SSEConnection {
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
      sessionId,
      mode,
      thinkingLevel: thinkingLevel ?? 'off',
      sourceType: sourceType ?? null,
      label: label ?? null
    }),
    signal: abortController.signal
  }).then(async (response) => {
    if (!response.ok) {
      const err = await response.json()
      connection.onError(err.error || `HTTP ${response.status}`)
      return
    }

    // pi 真实 sessionId 通过 response header 下发（新建/复用都带）
    const piSessionId = response.headers.get('x-claude-code-session-id')
    if (piSessionId) {
      connection.onSession(piSessionId)
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

        if (eventType === 'data') {
          try {
            const parsed = JSON.parse(eventData)
            // 不在这里按 type 硬过滤，把 type 和整个 parsed 对象都透给 hook
            connection.onData(parsed.type || 'stdout', parsed)
          } catch {
            connection.onData('stdout', { content: eventData })
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

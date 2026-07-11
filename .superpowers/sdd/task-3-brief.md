### Task 3: 前端 chat API 和类型定义

**Files:**
- Create: `apps/proxy-cli/src/api/chat.ts`
- Create: `apps/proxy-cli/src/types/chat.ts`

**Interfaces:**
- Consumes: `API_BASE = '/ui/api'` from `apps/proxy-cli/src/api/index.ts:5`
- Produces:
  - `ChatMessage` type — Task 4 的 useChat hook 和 ChatUI.tsx 使用
  - `ChatConversation` type — Task 4 使用
  - `sendChatMessage(prompt, sessionId?)` — Task 4 使用，返回 SSE EventSource
  - `LOCALSTORAGE_KEY = 'cc-chat-conversations'` — Task 4 使用

- [ ] **Step 1: 创建 chat 类型定义**

创建 `apps/proxy-cli/src/types/chat.ts`：

```typescript
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
```

- [ ] **Step 2: 创建 chat API 封装**

创建 `apps/proxy-cli/src/api/chat.ts`：

```typescript
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

/**
 * 发送对话消息，建立 SSE 连接
 * 返回 EventSource 供调用方监听事件
 */
export function sendChatMessage(prompt: string, sessionId?: string): EventSource {
  // POST 请求无法直接用 EventSource（它只支持 GET）
  // 先发 POST 获取 SSE URL 或使用 fetch + ReadableStream
  // 这里用 fetch + 手动解析 SSE
  // 但 EventSource 更简单——我们需要改造为 GET 或用 fetch 方式

  // 实际方案：用 fetch 发 POST，手动解析 SSE stream
  // 返回一个自定义对象模拟 EventSource 行为
  const body = JSON.stringify({
    tool: 'claude',
    prompt,
    stream: true,
    sessionId
  })

  // 创建 AbortController 供取消
  const abortController = new AbortController()

  // 自定义 SSE 连接对象
  const sseConnection = {
    abortController,
    onSession: ((_sessionId: string) => {}) as (sid: string) => void,
    onData: ((_type: string, _content: string) => {}) as (type: string, content: string) => void,
    onError: ((_message: string) => {}) as (msg: string) => void,
    onDone: ((_code: number) => {}) as (code: number) => void,
    aborted: false
  }

  fetch(`${API_BASE}/exec`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
    signal: abortController.signal
  }).then(async (response) => {
    if (!response.ok) {
      const err = await response.json()
      sseConnection.onError(err.error || `HTTP ${response.status}`)
      return
    }

    const reader = response.body?.getReader()
    if (!reader) {
      sseConnection.onError('No response body')
      return
    }

    const decoder = new TextDecoder()
    let buffer = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done || sseConnection.aborted) break

      buffer += decoder.decode(value, { stream: true })

      // 解析 SSE events
      const lines = buffer.split('\n')
      buffer = ''

      let currentEvent = ''
      let currentData = ''

      for (const line of lines) {
        if (line.startsWith('event: ')) {
          currentEvent = line.slice(7)
        } else if (line.startsWith('data: ')) {
          currentData = line.slice(6)
        } else if (line === '' && currentEvent && currentData) {
          // 完整 event，触发回调
          if (currentEvent === 'session') {
            sseConnection.onSession(currentData)
          } else if (currentEvent === 'data') {
            try {
              const parsed = JSON.parse(currentData)
              sseConnection.onData(parsed.type || 'stdout', parsed.content || '')
            } catch {
              // 非 JSON，当作 stdout
              sseConnection.onData('stdout', currentData)
            }
          } else if (currentEvent === 'error') {
            try {
              const parsed = JSON.parse(currentData)
              sseConnection.onError(parsed.message || currentData)
            } catch {
              sseConnection.onError(currentData)
            }
          } else if (currentEvent === 'done') {
            try {
              const parsed = JSON.parse(currentData)
              sseConnection.onDone(parsed.code ?? 0)
            } catch {
              sseConnection.onDone(0)
            }
          }
          currentEvent = ''
          currentData = ''
        } else if (line !== '' && !line.startsWith('event:') && !line.startsWith('data:')) {
          // 不完整行，保留到下次
          buffer = line
        }
      }
    }
  }).catch((err) => {
    if (!sseConnection.aborted) {
      sseConnection.onError(err.message || 'Connection failed')
    }
  })

  return sseConnection as unknown as EventSource  // 类型欺骗，实际返回 SSEConnection
}

// 更准确的返回类型
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

      // 解析 SSE events
      const events = buffer.split('\n\n')
      buffer = events.pop() || ''  // 最后一段可能不完整

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
```

- [ ] **Step 3: Commit**

```bash
git add apps/proxy-cli/src/types/chat.ts apps/proxy-cli/src/api/chat.ts
git commit -m "feat: add chat API layer and types for SSE connection"
```

---


import { useState, useCallback, useRef, useEffect } from 'react'
import { createChatConnection, loadConversations, saveConversations } from '../api/chat'
import type { ChatMessage, ChatConversation } from '../types/chat'

export function useChat() {
  const [conversations, setConversations] = useState<ChatConversation[]>(loadConversations())
  const [currentIndex, setCurrentIndex] = useState<number>(
    conversations.length > 0 ? conversations.length - 1 : -1
  )
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const connectionRef = useRef<ReturnType<typeof createChatConnection> | null>(null)
  const conversationsRef = useRef<ChatConversation[]>(conversations)

  // Keep ref in sync with state so SSE callbacks always read latest
  useEffect(() => {
    conversationsRef.current = conversations
  }, [conversations])

  const currentConversation = currentIndex >= 0 ? conversations[currentIndex] : null
  const messages = currentConversation?.messages ?? []
  const sessionId = currentConversation?.sessionId ?? undefined

  // 保存到 localStorage
  const persist = useCallback((updater: ChatConversation[] | ((prev: ChatConversation[]) => ChatConversation[])) => {
    if (typeof updater === 'function') {
      setConversations(prev => {
        const next = updater(prev)
        saveConversations(next)
        return next
      })
    } else {
      saveConversations(updater)
      setConversations(updater)
    }
  }, [])

  // 发送消息
  const sendMessage = useCallback((prompt: string) => {
    // 如果正在加载，不允许发送
    if (loading) return

    setLoading(true)
    setError(null)

    // 添加 user message
    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: prompt,
      timestamp: Date.now()
    }

    // Build initial snapshot from latest state via ref
    const currentConvs = conversationsRef.current
    let convIndex: number

    if (!sessionId) {
      // 新对话
      const newConv: ChatConversation = {
        sessionId: '',  // 临时为空，等 SSE session event 回填
        messages: [userMessage]
      }
      convIndex = currentConvs.length
      persist([...currentConvs, newConv])
    } else {
      // 继续现有对话
      convIndex = currentIndex
      persist(prev => {
        const patched = [...prev]
        patched[convIndex] = {
          ...patched[convIndex],
          messages: [...patched[convIndex].messages, userMessage]
        }
        return patched
      })
    }

    // 添加空的 assistant message placeholder
    persist(prev => {
      const patched = [...prev]
      const assistantMessage: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: '',
        timestamp: Date.now()
      }
      patched[convIndex] = {
        ...patched[convIndex],
        messages: [...patched[convIndex].messages, assistantMessage]
      }
      return patched
    })

    setCurrentIndex(convIndex)

    // 累积 stdout
    let accumulatedStdout = ''

    const connection = createChatConnection(prompt, sessionId)
    connectionRef.current = connection

    connection.onSession = (sid: string) => {
      // 回填 sessionId — use functional updater to avoid stale closure
      persist(prev => {
        const patched = [...prev]
        patched[convIndex] = { ...patched[convIndex], sessionId: sid }
        return patched
      })
    }

    connection.onData = (type: string, content: string) => {
      if (type === 'stdout') {
        accumulatedStdout += content

        // 实时更新 assistant message content — use functional updater
        persist(prev => {
          const patched = [...prev]
          const msgs = [...patched[convIndex].messages]
          msgs[msgs.length - 1] = {
            ...msgs[msgs.length - 1],
            content: accumulatedStdout
          }
          patched[convIndex] = { ...patched[convIndex], messages: msgs }
          return patched
        })
      }
      // stderr 不拼入 assistant content，忽略（后续可在 UI 中展示）
    }

    connection.onError = (message: string) => {
      setError(message)
      setLoading(false)
      connectionRef.current = null

      // 如果 assistant content 为空，移除 placeholder — use functional updater
      if (!accumulatedStdout) {
        persist(prev => {
          const patched = [...prev]
          const msgs = patched[convIndex].messages.slice(0, -1)
          patched[convIndex] = { ...patched[convIndex], messages: msgs }
          return patched
        })
      }
    }

    connection.onDone = (code: number) => {
      setLoading(false)
      connectionRef.current = null

      if (code !== 0 && !accumulatedStdout) {
        // 进程非零退出且无输出，移除 assistant placeholder — use functional updater
        persist(prev => {
          const patched = [...prev]
          const msgs = patched[convIndex].messages.slice(0, -1)
          patched[convIndex] = { ...patched[convIndex], messages: msgs }
          return patched
        })
      }
    }
  }, [sessionId, currentIndex, loading, persist])

  // 开始新对话
  const newConversation = useCallback(() => {
    // 如果正在加载，先取消
    if (connectionRef.current) {
      connectionRef.current.abort()
      connectionRef.current = null
      setLoading(false)
    }
    setCurrentIndex(-1)
    setError(null)
  }, [])

  // Cleanup: abort connection on unmount
  useEffect(() => {
    return () => {
      if (connectionRef.current) {
        connectionRef.current.abort()
        connectionRef.current = null
      }
    }
  }, [])

  return {
    messages,
    sessionId,
    loading,
    error,
    sendMessage,
    newConversation,
    conversations,
    currentIndex
  }
}

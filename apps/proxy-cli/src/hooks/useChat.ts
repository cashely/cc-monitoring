import { useState, useCallback, useRef } from 'react'
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

  const currentConversation = currentIndex >= 0 ? conversations[currentIndex] : null
  const messages = currentConversation?.messages ?? []
  const sessionId = currentConversation?.sessionId ?? undefined

  // 保存到 localStorage
  const persist = useCallback((updated: ChatConversation[]) => {
    saveConversations(updated)
    setConversations(updated)
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

    let updatedConversations: ChatConversation[]
    let convIndex: number

    if (!sessionId) {
      // 新对话
      const newConv: ChatConversation = {
        sessionId: '',  // 临时为空，等 SSE session event 回填
        messages: [userMessage]
      }
      updatedConversations = [...conversations, newConv]
      convIndex = updatedConversations.length - 1
    } else {
      // 继续现有对话
      updatedConversations = [...conversations]
      updatedConversations[currentIndex] = {
        ...updatedConversations[currentIndex],
        messages: [...updatedConversations[currentIndex].messages, userMessage]
      }
      convIndex = currentIndex
    }

    // 添加空的 assistant message placeholder
    const assistantMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'assistant',
      content: '',
      timestamp: Date.now()
    }
    updatedConversations[convIndex] = {
      ...updatedConversations[convIndex],
      messages: [...updatedConversations[convIndex].messages, assistantMessage]
    }

    setCurrentIndex(convIndex)

    // 累积 stdout
    let accumulatedStdout = ''

    const connection = createChatConnection(prompt, sessionId)
    connectionRef.current = connection

    connection.onSession = (sid: string) => {
      // 回填 sessionId
      const patched = [...updatedConversations]
      patched[convIndex] = { ...patched[convIndex], sessionId: sid }
      persist(patched)
    }

    connection.onData = (type: string, content: string) => {
      if (type === 'stdout') {
        accumulatedStdout += content

        // 实时更新 assistant message content
        const patched = [...updatedConversations]
        const msgs = [...patched[convIndex].messages]
        msgs[msgs.length - 1] = {
          ...msgs[msgs.length - 1],
          content: accumulatedStdout
        }
        patched[convIndex] = { ...patched[convIndex], messages: msgs }
        persist(patched)
      }
      // stderr 不拼入 assistant content，忽略（后续可在 UI 中展示）
    }

    connection.onError = (message: string) => {
      setError(message)
      setLoading(false)
      connectionRef.current = null

      // 如果 assistant content 为空，移除 placeholder
      const patched = [...updatedConversations]
      if (!accumulatedStdout) {
        const msgs = patched[convIndex].messages.slice(0, -1)
        patched[convIndex] = { ...patched[convIndex], messages: msgs }
        persist(patched)
      }
    }

    connection.onDone = (code: number) => {
      setLoading(false)
      connectionRef.current = null

      if (code !== 0 && !accumulatedStdout) {
        // 进程非零退出且无输出，移除 assistant placeholder
        const patched = [...updatedConversations]
        const msgs = patched[convIndex].messages.slice(0, -1)
        patched[convIndex] = { ...patched[convIndex], messages: msgs }
        persist(patched)
      }
    }
  }, [conversations, currentIndex, sessionId, loading, persist])

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

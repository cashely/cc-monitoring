import { useState, useCallback, useRef, useEffect } from 'react'
import { createChatConnection, loadConversations, saveConversations } from '../api/chat'
import type { ChatMessage, ChatConversation, ContentBlock, TextBlock, ThinkingBlock, ToolBlock, ThinkingLevel } from '../types/chat'
import { generateUUID } from '../utils/uuid'

export type ChatMode = 'chat' | 'learn'

export function useChat() {
  const [conversations, setConversations] = useState<ChatConversation[]>(loadConversations())
  const [currentIndex, setCurrentIndex] = useState<number>(
    conversations.length > 0 ? conversations.length - 1 : -1
  )
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // 会话模式：chat=只读问答（搜 docs），learn=浏览器学习（抓网页写 docs）
  const [mode, setModeState] = useState<ChatMode>('chat')
  // 思考等级：透传到后端请求 body
  const [thinkingLevel, setThinkingLevel] = useState<ThinkingLevel>('off')

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

    // 添加 user message：content 包成单个 text block
    const userMessage: ChatMessage = {
      id: generateUUID(),
      role: 'user',
      blocks: [{ type: 'text', id: generateUUID(), content: prompt }],
      timestamp: Date.now()
    }

    // Build initial snapshot from latest state via ref
    const currentConvs = conversationsRef.current
    let convIndex: number
    let currentSessionId: string | undefined = sessionId

    if (!sessionId) {
      // 新对话 - 不在前端生成 sessionId，等后端 response header 下发 pi 真实 id
      const newConv: ChatConversation = {
        sessionId: '',
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

    // 添加空的 assistant message placeholder（blocks 为空数组，后续事件往里累积）
    persist(prev => {
      const patched = [...prev]
      const assistantMessage: ChatMessage = {
        id: generateUUID(),
        role: 'assistant',
        blocks: [],
        timestamp: Date.now()
      }
      patched[convIndex] = {
        ...patched[convIndex],
        messages: [...patched[convIndex].messages, assistantMessage]
      }
      return patched
    })

    setCurrentIndex(convIndex)

    // 记录 assistant placeholder 的 id，所有后续事件都改这条
    let assistantMsgId = ''
    let hasAnyBlock = false

    const connection = createChatConnection(prompt, currentSessionId, mode, thinkingLevel)
    connectionRef.current = connection

    // 后端通过 response header 下发 pi 真实 sessionId（新建/复用都带）。
    // 新对话时当前 conversation.sessionId 为 ''，这里回填；复用场景 header 回传的 id 与已存一致，幂等。
    connection.onSession = (piId: string) => {
      currentSessionId = piId
      persist(prev => {
        const patched = [...prev]
        if (!patched[convIndex]) return prev
        patched[convIndex] = { ...patched[convIndex], sessionId: piId }
        return patched
      })
    }

    // 通用：定位最后一条 assistant message 的 blocks 数组并更新
    const updateAssistantBlocks = (fn: (blocks: ContentBlock[]) => ContentBlock[]) => {
      persist(prev => {
        const patched = [...prev]
        if (!patched[convIndex]) return prev
        const msgs = [...patched[convIndex].messages]
        const lastIdx = msgs.length - 1
        const last = msgs[lastIdx]
        if (!last || last.role !== 'assistant') return prev
        msgs[lastIdx] = { ...last, blocks: fn(last.blocks) }
        patched[convIndex] = { ...patched[convIndex], messages: msgs }
        return patched
      })
    }

    connection.onData = (type: string, data: any) => {
      // 记住 assistant placeholder id（首次回调时已写入 state）
      if (!assistantMsgId) {
        const cur = conversationsRef.current[convIndex]
        if (cur && cur.messages.length > 0) {
          assistantMsgId = cur.messages[cur.messages.length - 1].id
        }
      }

      switch (type) {
        case 'text_delta': {
          const delta: string = data?.content ?? ''
          if (!delta) return
          hasAnyBlock = true
          updateAssistantBlocks(blocks => {
            const next = [...blocks]
            // 找最后一个 text block 追加；否则新建
            for (let i = next.length - 1; i >= 0; i--) {
              if (next[i].type === 'text') {
                const tb = next[i] as TextBlock
                next[i] = { ...tb, content: tb.content + delta }
                return next
              }
            }
            next.push({ type: 'text', id: generateUUID(), content: delta })
            return next
          })
          break
        }
        case 'thinking_delta': {
          const delta: string = data?.content ?? ''
          if (!delta) return
          hasAnyBlock = true
          updateAssistantBlocks(blocks => {
            const next = [...blocks]
            for (let i = next.length - 1; i >= 0; i--) {
              if (next[i].type === 'thinking') {
                const tb = next[i] as ThinkingBlock
                next[i] = { ...tb, content: tb.content + delta }
                return next
              }
            }
            next.push({ type: 'thinking', id: generateUUID(), content: delta })
            return next
          })
          break
        }
        case 'tool_start': {
          hasAnyBlock = true
          const toolBlock: ToolBlock = {
            type: 'tool',
            id: generateUUID(),
            toolCallId: data?.toolCallId ?? '',
            toolName: data?.toolName ?? '',
            args: data?.args,
            status: 'running'
          }
          updateAssistantBlocks(blocks => [...blocks, toolBlock])
          break
        }
        case 'tool_end': {
          updateAssistantBlocks(blocks => {
            const next = [...blocks]
            for (let i = 0; i < next.length; i++) {
              const b = next[i]
              if (b.type === 'tool' && (b as ToolBlock).toolCallId === data?.toolCallId) {
                const tb = b as ToolBlock
                next[i] = {
                  ...tb,
                  result: data?.result,
                  isError: data?.isError,
                  durationMs: data?.durationMs,
                  status: 'done'
                }
                break
              }
            }
            return next
          })
          break
        }
        default:
          // 未识别的 type 忽略（如旧 stdout/stderr 已经不再下发）
          break
      }
    }

    connection.onError = (message: string) => {
      setError(message)
      setLoading(false)
      connectionRef.current = null

      // 如果 assistant 还没收到任何 block，移除 placeholder
      if (!hasAnyBlock) {
        persist(prev => {
          const patched = [...prev]
          if (!patched[convIndex]) return prev
          const msgs = patched[convIndex].messages.slice(0, -1)
          patched[convIndex] = { ...patched[convIndex], messages: msgs }
          return patched
        })
      }
    }

    connection.onDone = (code: number) => {
      setLoading(false)
      connectionRef.current = null

      if (code !== 0 && !hasAnyBlock) {
        // 进程非零退出且无输出，移除 assistant placeholder
        persist(prev => {
          const patched = [...prev]
          if (!patched[convIndex]) return prev
          const msgs = patched[convIndex].messages.slice(0, -1)
          patched[convIndex] = { ...patched[convIndex], messages: msgs }
          return patched
        })
      }
    }
  }, [sessionId, currentIndex, loading, persist, mode, thinkingLevel])

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

  // 切换模式：chat/learn 的 session 工具集不同，强制开新对话避免复用错 session
  const setMode = useCallback((m: ChatMode) => {
    setModeState(m)
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
    currentIndex,
    mode,
    setMode,
    thinkingLevel,
    setThinkingLevel
  }
}

import { useCallback, useEffect, useRef, useState } from 'react'
import { createChatConnection } from '../api/chat'
import type { ToolBlock } from '../types/chat'
import { generateUUID } from '../utils/uuid'

export type LearnSource = 'url' | 'file'

export interface LearnTask {
  source: LearnSource
  // url 模式为网页 URL 字符串；file 模式为 upload 拿到的 markdown 文本
  payload: string
  // Drawer 顶部展示的来源标签（URL 或文件名），缺省回退为 payload
  label?: string
}

export interface LearnRound {
  roundIndex: number
  thinking: string
  text: string
  tools: ToolBlock[]
  done: boolean
}

export type LearnStatus = 'idle' | 'streaming' | 'done'

// 3 阶段流水线进度：outline 大纲生成 / refine 逐条细化 / tag 富 tag 索引
export interface StageState {
  name: 'outline' | 'refine' | 'tag'
  index: number
  total: number
  failedCount: number
}

// 学习模式流式 hook：start 新建 learn session（不传 sessionId），followup 改走 chat 模式新建会话，
// 按 round_start / round_end 把 SSE 事件分组累积成 rounds，并按 stage_* 事件展示 3 阶段进度
export function useLearnStream() {
  const [rounds, setRounds] = useState<LearnRound[]>([])
  const [status, setStatus] = useState<LearnStatus>('idle')
  const [error, setError] = useState<string | null>(null)
  const [task, setTask] = useState<LearnTask | null>(null)
  const [stage, setStage] = useState<StageState | null>(null)
  const connectionRef = useRef<ReturnType<typeof createChatConnection> | null>(null)
  // 后端通过 x-claude-code-session-id 下发的 pi sessionId。
  // learn 流水线无驻留 session（done 后即清空）；chat followup 应复用以保留多轮上下文。
  const sessionIdRef = useRef<string | null>(null)
  // 当前连接模式：learn 流水线结束清 sessionId；chat followup 结束保留，下一轮复用
  const connectionModeRef = useRef<'learn' | 'chat'>('learn')

  // 所有 delta / tool 事件都归属「最后一个未结束的 round」（当前轮）
  const mutateLastRound = useCallback((type: string, fn: (r: LearnRound) => LearnRound) => {
    setRounds(prev => {
      if (prev.length === 0) {
        // rounds 为空时 delta 被丢弃（round_start 之前的迟到事件），打日志便于排查，行为不变
        console.warn('[useLearnStream] delta before round_start', { type, roundsLen: prev.length })
        return prev
      }
      const next = [...prev]
      next[next.length - 1] = fn(next[next.length - 1])
      return next
    })
  }, [])

  // 把 onSession / onData / onError / onDone 挂到一条连接上，start / followup 共用
  const attachHandlers = useCallback((connection: ReturnType<typeof createChatConnection>) => {
    connection.onSession = (id: string) => {
      sessionIdRef.current = id
    }

    connection.onData = (type: string, data: any) => {
      switch (type) {
        case 'round_start': {
          const idx: number = data?.roundIndex ?? 0
          setRounds(prev => {
            // 幂等：同一 roundIndex 已存在则不重复建
            if (prev.some(r => r.roundIndex === idx)) return prev
            return [...prev, { roundIndex: idx, thinking: '', text: '', tools: [], done: false }]
          })
          break
        }
        case 'round_end': {
          const idx: number = data?.roundIndex ?? 0
          setRounds(prev =>
            prev.map(r => (r.roundIndex === idx ? { ...r, done: true } : r))
          )
          break
        }
        case 'stage_start': {
          // 新阶段开始：重置进度（refine 带 totalItems）
          const name = data?.stage as StageState['name']
          setStage({ name, index: 0, total: data?.totalItems ?? 0, failedCount: 0 })
          break
        }
        case 'stage_item_start': {
          setStage(prev => (prev ? { ...prev, index: data?.index ?? 0 } : prev))
          break
        }
        case 'stage_item_end': {
          // index 已在 item_start 设置，无需变更
          break
        }
        case 'stage_item_failed': {
          setStage(prev => (prev ? { ...prev, failedCount: prev.failedCount + 1 } : prev))
          break
        }
        case 'stage_end': {
          // 清进度：下一阶段 stage_start 会重新设置；最终阶段结束后进度行隐藏
          setStage(null)
          break
        }
        case 'text_delta': {
          const delta: string = data?.content ?? ''
          if (delta) mutateLastRound(type, r => ({ ...r, text: r.text + delta }))
          break
        }
        case 'thinking_delta': {
          const delta: string = data?.content ?? ''
          if (delta) mutateLastRound(type, r => ({ ...r, thinking: r.thinking + delta }))
          break
        }
        case 'tool_start': {
          const tool: ToolBlock = {
            type: 'tool',
            id: generateUUID(),
            toolCallId: data?.toolCallId ?? '',
            toolName: data?.toolName ?? '',
            args: data?.args,
            status: 'running'
          }
          mutateLastRound(type, r => ({ ...r, tools: [...r.tools, tool] }))
          break
        }
        case 'tool_end': {
          const callId: string = data?.toolCallId ?? ''
          mutateLastRound(type, r => ({
            ...r,
            tools: r.tools.map(tb =>
              tb.toolCallId === callId
                ? {
                    ...tb,
                    result: data?.result,
                    isError: data?.isError,
                    durationMs: data?.durationMs,
                    status: 'done'
                  }
                : tb
            )
          }))
          break
        }
        default:
          // 未识别的 type 忽略
          break
      }
    }

    connection.onError = (message: string) => {
      setError(message)
      setStatus('done')
      setStage(null)
      connectionRef.current = null
    }

    connection.onDone = () => {
      setStatus('done')
      connectionRef.current = null
      // learn 流水线无驻留 session，done 后清掉下发的 pi sessionId；
      // chat followup 保留 sessionId，下一轮追问复用同一 pi session 保留上下文。
      if (connectionModeRef.current === 'learn') {
        sessionIdRef.current = null
      }
    }
  }, [mutateLastRound])

  const start = useCallback((t: LearnTask) => {
    if (connectionRef.current) {
      connectionRef.current.abort()
      connectionRef.current = null
    }
    // 新学习任务：重置 session，避免沿用上一次 learn/chat 会话
    connectionModeRef.current = 'learn'
    sessionIdRef.current = null
    setRounds([])
    setError(null)
    setStage(null)
    setTask(t)
    setStatus('streaming')

    // 每次学习任务都是新建 session：不传 sessionId
    const connection = createChatConnection(t.payload, undefined, 'learn', undefined, t.source, t.label)
    connectionRef.current = connection
    attachHandlers(connection)
  }, [attachHandlers])

  // 追问：走 chat 模式。首次追问时 learn sessionId 已被清掉（传 undefined），
  // 后端新建 chat session 后通过 onSession 下发；后续追问复用该 sessionId 保留多轮上下文。
  const followup = useCallback((prompt: string) => {
    if (connectionRef.current) {
      connectionRef.current.abort()
      connectionRef.current = null
    }
    connectionModeRef.current = 'chat'
    setStatus('streaming')
    setError(null)
    setStage(null)

    const connection = createChatConnection(prompt, sessionIdRef.current ?? undefined, 'chat')
    connectionRef.current = connection
    attachHandlers(connection)
  }, [attachHandlers])

  const cancel = useCallback(() => {
    if (connectionRef.current) {
      connectionRef.current.abort()
      connectionRef.current = null
    }
    setStatus('done')
  }, [])

  // unmount 时 abort，避免流泄漏
  useEffect(() => {
    return () => {
      if (connectionRef.current) {
        connectionRef.current.abort()
        connectionRef.current = null
      }
    }
  }, [])

  return { rounds, status, error, task, stage, start, followup, cancel }
}

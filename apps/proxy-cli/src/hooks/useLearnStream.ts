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

// 学习模式流式 hook：每次任务新建 learn session（不传 sessionId），
// 按 round_start / round_end 把 SSE 事件分组累积成 rounds
export function useLearnStream() {
  const [rounds, setRounds] = useState<LearnRound[]>([])
  const [status, setStatus] = useState<LearnStatus>('idle')
  const [error, setError] = useState<string | null>(null)
  const [task, setTask] = useState<LearnTask | null>(null)
  const connectionRef = useRef<ReturnType<typeof createChatConnection> | null>(null)

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

  const start = useCallback((t: LearnTask) => {
    if (connectionRef.current) {
      connectionRef.current.abort()
      connectionRef.current = null
    }
    setRounds([])
    setError(null)
    setTask(t)
    setStatus('streaming')

    // 每次学习任务都是新建 session：不传 sessionId
    const connection = createChatConnection(t.payload, undefined, 'learn')
    connectionRef.current = connection

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
      connectionRef.current = null
    }

    connection.onDone = () => {
      setStatus('done')
      connectionRef.current = null
    }
  }, [mutateLastRound])

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

  return { rounds, status, error, task, start, cancel }
}

import { useState, useEffect, useCallback, useRef } from 'react'
import { LogItem, RequestSummaryType } from '../types'

interface UseLogsOptions {
  level?: string
  grep?: string
}

const REQUEST_SUMMARY_TYPES: Set<string> = new Set(['request_started', 'request_completed'])

export function useLogs(options: UseLogsOptions = {}): {
  logs: LogItem[]
  pause: () => void
  resume: () => void
  clear: () => void
} {
  const [logs, setLogs] = useState<LogItem[]>([])
  const [paused, setPaused] = useState(false)
  const pausedRef = useRef(paused)
  pausedRef.current = paused

  useEffect(() => {
    // In dev mode, connect directly to API server (Vite WS proxy unreliable)
    const wsHost = import.meta.env.DEV ? 'localhost:3000' : location.host
    const wsUrl = `${location.protocol.replace('http', 'ws')}//${wsHost}/ui/api/logs/stream`
    const ws = new WebSocket(wsUrl)

    ws.onmessage = (event) => {
      if (pausedRef.current) return

      try {
        const parsed = JSON.parse(event.data)

        // Detect lightweight request summaries
        if (REQUEST_SUMMARY_TYPES.has(parsed.type)) {
          const summary: LogItem = { ...parsed, level: 'info' }

          if (options.level && summary.level !== options.level) return

          setLogs(prev => [...prev.slice(-499), summary])
          return
        }

        // Traditional log entry - convert Pino numeric level to string
        const NUM_TO_LEVEL: Record<number, string> = {
          10: 'trace',
          20: 'debug',
          30: 'info',
          40: 'warn',
          50: 'error',
          60: 'fatal'
        }

        const log: LogItem = {
          ...parsed,
          level: typeof parsed.level === 'number' ? NUM_TO_LEVEL[parsed.level] || 'info' : parsed.level
        }

        if (options.level && log.level !== options.level) return
        if (options.grep && 'msg' in log && !log.msg.toLowerCase().includes(options.grep.toLowerCase())) return

        setLogs(prev => [...prev.slice(-499), log])
      } catch {
        // Skip invalid JSON
      }
    }

    ws.onerror = (error) => {
      console.error('WebSocket error:', error)
    }

    return () => ws.close()
  }, [options.level, options.grep])

  const pause = useCallback(() => setPaused(true), [])
  const resume = useCallback(() => setPaused(false), [])
  const clear = useCallback(() => setLogs([]), [])

  return { logs, pause, resume, clear }
}

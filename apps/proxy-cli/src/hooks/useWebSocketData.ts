import { useState, useEffect, useCallback, useRef } from 'react'
import { fetchStatus, fetchStatusHistory, fetchRequests, fetchStats, fetchTodayStats } from '../api'
import type { StatusApiResponse, StatusDataPoint, RequestSummary, StatsData, TodayStats } from '../types'

type ConnectionState = 'connecting' | 'connected' | 'disconnected'

const INITIAL_STATUS: StatusApiResponse = {
  status: 'stopped',
  cpu: 0,
  memory: 0,
  uptime: 0,
  restarts: 0
}

const INITIAL_STATS: StatsData = {
  hourly: {},
  lastUpdated: null
}

const INITIAL_TODAY: TodayStats = {
  input_tokens: 0,
  output_tokens: 0,
  cache_read_tokens: 0,
  request_count: 0,
  models: {}
}

const HEARTBEAT_TIMEOUT_MS = 30000

// Compute since parameter for fetchStats: local time - 30 days → UTC ISO string.
// This ensures the "daily" boundary follows the user's timezone.
function computeStatsSince(): string {
  const d = new Date()
  d.setDate(d.getDate() - 30)
  d.setHours(0, 0, 0, 0)
  return d.toISOString()
}

export function useWebSocketData(): {
  status: StatusApiResponse
  history: StatusDataPoint[]
  requests: RequestSummary[]
  stats: StatsData
  todayStats: TodayStats
  connectionState: ConnectionState
  loading: boolean
  reconnect: () => void
} {
  const [status, setStatus] = useState<StatusApiResponse>(INITIAL_STATUS)
  const [history, setHistory] = useState<StatusDataPoint[]>([])
  const [requests, setRequests] = useState<RequestSummary[]>([])
  const [stats, setStats] = useState<StatsData>(INITIAL_STATS)
  const [todayStats, setTodayStats] = useState<TodayStats>(INITIAL_TODAY)
  const [connectionState, setConnectionState] = useState<ConnectionState>('connecting')
  const [loading, setLoading] = useState(true)

  const wsRef = useRef<WebSocket | null>(null)
  const heartbeatTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const reconnectAttemptRef = useRef(0)
  const mountedRef = useRef(false)

  const clearHeartbeatTimer = useCallback(() => {
    if (heartbeatTimerRef.current) {
      clearInterval(heartbeatTimerRef.current)
      heartbeatTimerRef.current = null
    }
  }, [])

  const refreshAll = useCallback(async () => {
    const [statusData, historyData, requestsData, statsData, todayData] = await Promise.all([
      fetchStatus(),
      fetchStatusHistory(),
      fetchRequests(100),
      fetchStats(computeStatsSince()),
      fetchTodayStats()
    ])
    setStatus(statusData)
    setHistory(historyData.history)
    setRequests(requestsData.requests || [])
    setStats(statsData)
    setTodayStats(todayData)
    setLoading(false)
  }, [])

  const connect = useCallback(() => {
    // Clean up previous connection
    if (wsRef.current) {
      wsRef.current.close()
      wsRef.current = null
    }
    clearHeartbeatTimer()

    setConnectionState('connecting')

    // Derive WebSocket URL (dev: direct to API server; prod: same host)
    const wsHost = import.meta.env.DEV ? 'localhost:3000' : location.host
    const wsUrl = `${location.protocol.replace('http', 'ws')}//${wsHost}/ui/api/ws`
    const ws = new WebSocket(wsUrl)
    wsRef.current = ws

    // Heartbeat timeout: track last server activity
    let lastActivity = Date.now()

    ws.onopen = () => {
      setConnectionState('connected')
      reconnectAttemptRef.current = 0
      lastActivity = Date.now()

      // Start heartbeat timeout checker (5s interval)
      heartbeatTimerRef.current = setInterval(() => {
        if (Date.now() - lastActivity > HEARTBEAT_TIMEOUT_MS) {
          // No server message in 30s — treat as disconnected
          setConnectionState('disconnected')
          ws.close()
        }
      }, 5000)
    }

    ws.onmessage = (event) => {
      lastActivity = Date.now()

      try {
        const msg = JSON.parse(event.data)

        switch (msg.type) {
          case 'ping':
            // Heartbeat from server, respond with pong
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({ type: 'pong' }))
            }
            break

          case 'status':
            if (msg.action === 'snapshot') {
              setStatus({
                status: msg.data.status,
                cpu: msg.data.cpu,
                memory: msg.data.memory,
                uptime: msg.data.uptime,
                restarts: msg.data.restarts
              })
              setHistory(msg.data.history || [])
            }
            break

          case 'request':
            if (msg.action === 'new' || msg.action === 'update') {
              setRequests(prev => {
                // For 'update' with pendingId: remove the pending record first
                let filtered = prev
                if (msg.action === 'update' && msg.data.pendingId) {
                  filtered = prev.filter(r => r.compositeId !== msg.data.pendingId)
                }
                // 去重：如果已存在相同 compositeId 的请求，先移除
                filtered = filtered.filter(r => r.compositeId !== msg.data.compositeId)
                // 2. 添加新请求
                const withNew = [msg.data, ...filtered]
                // 3. 按 timestamp 倒序排序（确保时间顺序正确）
                const sorted = withNew.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
                // 4. 截取前 1000 条（与后端 LIMIT 一致）
                return sorted.slice(0, 1000)
              })
              // New request arrived — refresh today's real-time stats
              fetchTodayStats().then(setTodayStats).catch(() => {})
            }
            break

          case 'stats':
            if (msg.action === 'notify') {
              // Stats file changed — re-fetch via REST
              fetchStats(computeStatsSince()).then(setStats).catch(() => {})
            }
            break
        }
      } catch {
        // Skip invalid JSON
      }
    }

    ws.onclose = () => {
      setConnectionState('disconnected')
      clearHeartbeatTimer()
      if (wsRef.current === ws) wsRef.current = null
    }

    ws.onerror = () => {
      // onclose will fire after this, setting disconnected
    }
  }, [clearHeartbeatTimer])

  // Initial REST fetch + WebSocket connect
  useEffect(() => {
    refreshAll().catch(() => { setLoading(false) })
    connect()
    mountedRef.current = true
    return () => {
      wsRef.current?.close()
      clearHeartbeatTimer()
      mountedRef.current = false
    }
  }, [refreshAll, connect, clearHeartbeatTimer])

  // On tab refocus: pull latest data once so user doesn't see stale state.
  // WS stays connected in background — only REST re-sync on visible.
  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        refreshAll().catch(() => {})
      }
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => document.removeEventListener('visibilitychange', onVisibilityChange)
  }, [refreshAll])

  // Auto-reconnect with exponential backoff (1s, 2s, 4s, max 8s)
  // Skip reconnect on first mount — initial connection is handled by mount effect
  useEffect(() => {
    if (connectionState !== 'disconnected') return
    if (!mountedRef.current) return

    const delay = Math.min(1000 * Math.pow(2, reconnectAttemptRef.current), 8000)
    reconnectAttemptRef.current++

    const timer = setTimeout(() => {
      connect()
    }, delay)

    return () => clearTimeout(timer)
  }, [connectionState, connect])

  const reconnect = useCallback(() => {
    reconnectAttemptRef.current = 0
    connect()
  }, [connect])

  return { status, history, requests, stats, todayStats, connectionState, loading, reconnect }
}

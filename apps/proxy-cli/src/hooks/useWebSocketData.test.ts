import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { MockWebSocket } from '../test/setup'
import { useWebSocketData } from './useWebSocketData'
import type { StatusApiResponse, StatsData, TodayStats } from '../types'

// Mock the API module
vi.mock('../api', () => ({
  fetchStatus: vi.fn(),
  fetchStatusHistory: vi.fn(),
  fetchRequests: vi.fn(),
  fetchStats: vi.fn(),
  fetchTodayStats: vi.fn(),
}))

import { fetchStatus, fetchStatusHistory, fetchRequests, fetchStats, fetchTodayStats } from '../api'

const MOCK_STATUS: StatusApiResponse = {
  status: 'online',
  cpu: 25,
  memory: 120,
  uptime: 3600,
  restarts: 0,
}

const MOCK_HISTORY = [
  { timestamp: 1000, cpu: 20, memory: 100 },
  { timestamp: 2000, cpu: 30, memory: 110 },
]

const MOCK_REQUESTS = {
  requests: [
    {
      requestId: 'r1',
      sessionId: 's1',
      compositeId: 'c1',
      timestamp: '2025-01-01T00:00:00Z',
      method: 'POST',
      path: '/v1/chat',
      statusCode: 200,
      responseTime: 1500,
    },
  ],
}

const MOCK_STATS: StatsData = {
  hourly: { '10': { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 20 } },
  daily: {},
  lastUpdated: '2025-01-01T10:00:00Z',
}

const MOCK_TODAY: TodayStats = {
  input_tokens: 100,
  output_tokens: 50,
  cache_read_tokens: 20,
  request_count: 1,
  models: {},
}

function setupMocks() {
  vi.mocked(fetchStatus).mockResolvedValue(MOCK_STATUS)
  vi.mocked(fetchStatusHistory).mockResolvedValue({ history: MOCK_HISTORY })
  vi.mocked(fetchRequests).mockResolvedValue(MOCK_REQUESTS)
  vi.mocked(fetchStats).mockResolvedValue(MOCK_STATS)
  vi.mocked(fetchTodayStats).mockResolvedValue(MOCK_TODAY)
}

function getWs(): MockWebSocket {
  return MockWebSocket.instances[MockWebSocket.instances.length - 1]
}

function wsMessage(data: object) {
  act(() => {
    const ws = getWs()
    ws.onmessage!({ data: JSON.stringify(data) })
  })
}

function wsOpen() {
  const ws = getWs()
  ws.readyState = 1 // WebSocket.OPEN
  act(() => { ws.onopen!() })
}

function wsClose() {
  const ws = getWs()
  act(() => { ws.onclose!() })
}

describe('useWebSocketData', () => {
  beforeEach(() => {
    MockWebSocket.reset()
    vi.clearAllMocks()
    setupMocks()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('fetches initial data via REST on mount', async () => {
    await act(async () => {
      renderHook(() => useWebSocketData())
    })

    expect(fetchStatus).toHaveBeenCalled()
    expect(fetchStatusHistory).toHaveBeenCalled()
    expect(fetchRequests).toHaveBeenCalled()
    expect(fetchStats).toHaveBeenCalled()
  })

  it('populates state from initial REST fetch', async () => {
    let result: any
    await act(async () => {
      const hook = renderHook(() => useWebSocketData())
      result = hook.result
    })

    expect(result.current.status.status).toBe('online')
    expect(result.current.status.cpu).toBe(25)
    expect(result.current.history).toEqual(MOCK_HISTORY)
    expect(result.current.requests).toEqual(MOCK_REQUESTS.requests)
    expect(result.current.stats).toEqual(MOCK_STATS)
  })

  it('sets loading to false after initial REST fetch', async () => {
    let result: any
    await act(async () => {
      const hook = renderHook(() => useWebSocketData())
      result = hook.result
    })

    expect(result.current.loading).toBe(false)
  })

  it('opens WebSocket connection on mount', async () => {
    await act(async () => {
      renderHook(() => useWebSocketData())
    })

    expect(MockWebSocket.instances.length).toBeGreaterThan(0)

    const ws = getWs()
    expect(ws.url).toContain('/ui/api/ws')
  })

  it('transitions to connected on ws open', async () => {
    let result: any
    await act(async () => {
      const hook = renderHook(() => useWebSocketData())
      result = hook.result
    })

    wsOpen()

    expect(result.current.connectionState).toBe('connected')
  })

  it('handles status snapshot message', async () => {
    let result: any
    await act(async () => {
      const hook = renderHook(() => useWebSocketData())
      result = hook.result
    })

    wsOpen()

    wsMessage({
      type: 'status',
      action: 'snapshot',
      data: {
        status: 'stopped',
        cpu: 10,
        memory: 50,
        uptime: 0,
        restarts: 2,
        history: [{ timestamp: 3000, cpu: 15, memory: 60 }],
      },
    })

    expect(result.current.status.status).toBe('stopped')
    expect(result.current.status.cpu).toBe(10)
    expect(result.current.status.restarts).toBe(2)
    expect(result.current.history).toEqual([{ timestamp: 3000, cpu: 15, memory: 60 }])
  })

  it('handles request new message', async () => {
    let result: any
    await act(async () => {
      const hook = renderHook(() => useWebSocketData())
      result = hook.result
    })

    wsOpen()

    wsMessage({
      type: 'request',
      action: 'new',
      data: {
        requestId: 'r2',
        sessionId: 's2',
        compositeId: 'c2',
        timestamp: '2025-01-02T00:00:00Z',
        method: 'POST',
        path: '/v1/messages',
        statusCode: 0,
        responseTime: 0,
      },
    })

    const reqs = result.current.requests
    const newReq = reqs.find(r => r.requestId === 'r2')
    expect(newReq).toBeDefined()
    expect(newReq!.statusCode).toBe(0)
    expect(newReq!.responseTime).toBe(0)
    // New request should appear at front (index 0), not appended at end
    expect(reqs[0].requestId).toBe('r2')
  })

  it('responds pong to ping message', async () => {
    await act(async () => {
      renderHook(() => useWebSocketData())
    })

    wsOpen()

    const sendSpy = vi.spyOn(getWs(), 'send')

    wsMessage({ type: 'ping' })

    expect(sendSpy).toHaveBeenCalledWith(JSON.stringify({ type: 'pong' }))
  })

  it('re-fetches stats on stats notify message', async () => {
    vi.mocked(fetchStats).mockResolvedValue({
      hourly: { '11': { input_tokens: 200, output_tokens: 100, cache_read_input_tokens: 30 } },
      daily: {},
      lastUpdated: '2025-01-01T11:00:00Z',
    })

    let result: any
    await act(async () => {
      const hook = renderHook(() => useWebSocketData())
      result = hook.result
    })

    wsOpen()

    wsMessage({ type: 'stats', action: 'notify' })

    // fetchStats was called once initially, now called again
    expect(fetchStats).toHaveBeenCalledTimes(2)

    // Wait for the async setStats from the stats notify handler
    await act(async () => {
      // Let the promise from fetchStats().then(setStats) resolve
    })

    expect(result.current.stats.hourly['11']).toBeDefined()
  })

  it('detects heartbeat timeout and sets disconnected', async () => {
    vi.useFakeTimers()

    let result: any
    await act(async () => {
      const hook = renderHook(() => useWebSocketData())
      result = hook.result
    })

    wsOpen()
    expect(result.current.connectionState).toBe('connected')

    // Advance time beyond heartbeat timeout (30s + 5s check interval)
    act(() => { vi.advanceTimersByTime(35000) })

    expect(result.current.connectionState).toBe('disconnected')
  })

  it('auto-reconnects with exponential backoff after disconnect', async () => {
    vi.useFakeTimers()

    let result: any
    await act(async () => {
      const hook = renderHook(() => useWebSocketData())
      result = hook.result
    })

    const initialWs = getWs()

    wsOpen()
    expect(result.current.connectionState).toBe('connected')

    // Simulate disconnect
    wsClose()
    expect(result.current.connectionState).toBe('disconnected')

    // First reconnect: 1s delay
    act(() => { vi.advanceTimersByTime(1000) })

    // A new WebSocket instance was created for reconnect
    // Old ws.close() removed it from instances; new one was added
    expect(MockWebSocket.instances.length).toBeGreaterThan(0)
    const secondWs = getWs()
    expect(secondWs).not.toBe(initialWs)
  })

  it('reconnect() resets backoff and reconnects immediately', async () => {
    vi.useFakeTimers()

    let result: any
    await act(async () => {
      const hook = renderHook(() => useWebSocketData())
      result = hook.result
    })

    const initialWs = getWs()
    wsOpen()

    // Disconnect
    wsClose()
    expect(result.current.connectionState).toBe('disconnected')

    // Manual reconnect resets backoff
    act(() => { result.current.reconnect() })

    expect(MockWebSocket.instances.length).toBeGreaterThan(0)
    expect(result.current.connectionState).toBe('connecting')
  })

  it('cleans up WebSocket and timers on unmount', async () => {
    vi.useFakeTimers()

    let unmount: () => void
    await act(async () => {
      const hook = renderHook(() => useWebSocketData())
      unmount = hook.unmount
    })

    const ws = getWs()
    const closeSpy = vi.spyOn(ws, 'close')

    act(() => { unmount!() })

    expect(closeSpy).toHaveBeenCalled()
  })
})

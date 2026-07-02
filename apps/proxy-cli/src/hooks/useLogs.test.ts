import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useLogs } from './useLogs'
import type { LogEntry } from '../types'

// MockWebSocket injected via setup.ts

const makeLog = (level: string, msg: string): LogEntry => ({
  level: level as LogEntry['level'],
  time: new Date().toISOString(),
  requestId: 'req-1',
  method: 'GET',
  path: '/test',
  auth: 'present' as LogEntry['auth'],
  msg
})

describe('useLogs', () => {
  let MockWS: any

  beforeEach(() => {
    MockWS = (globalThis as any).WebSocket
    MockWS.reset()
  })

  afterEach(() => {
    MockWS.reset()
  })

  it('initializes with empty logs array', () => {
    const { result } = renderHook(() => useLogs())
    expect(result.current.logs).toEqual([])
  })

  it('receives log entries via WebSocket', () => {
    const { result } = renderHook(() => useLogs())

    const ws = MockWS.instances[0]
    const log = makeLog('info', 'test message')

    act(() => {
      ws.onmessage!({ data: JSON.stringify(log) })
    })

    expect(result.current.logs).toHaveLength(1)
    expect(result.current.logs[0].msg).toBe('test message')
  })

  it('skips invalid JSON messages', () => {
    const { result } = renderHook(() => useLogs())

    const ws = MockWS.instances[0]

    act(() => {
      ws.onmessage!({ data: 'not-json' })
    })

    expect(result.current.logs).toHaveLength(0)
  })

  it('filters by level', () => {
    const { result } = renderHook(() => useLogs({ level: 'error' }))

    const ws = MockWS.instances[0]

    act(() => {
      ws.onmessage!({ data: JSON.stringify(makeLog('info', 'info msg')) })
      ws.onmessage!({ data: JSON.stringify(makeLog('error', 'error msg')) })
    })

    expect(result.current.logs).toHaveLength(1)
    expect(result.current.logs[0].level).toBe('error')
  })

  it('filters by grep substring', () => {
    const { result } = renderHook(() => useLogs({ grep: 'proxy' }))

    const ws = MockWS.instances[0]

    act(() => {
      ws.onmessage!({ data: JSON.stringify(makeLog('info', 'proxy started')) })
      ws.onmessage!({ data: JSON.stringify(makeLog('info', 'server started')) })
    })

    expect(result.current.logs).toHaveLength(1)
    expect(result.current.logs[0].msg).toBe('proxy started')
  })

  it('pause stops receiving logs', () => {
    const { result } = renderHook(() => useLogs())

    const ws = MockWS.instances[0]

    // Pause in one act (triggers re-render, updates pausedRef)
    act(() => {
      result.current.pause()
    })

    // Send message in separate act - pausedRef.current should now be true
    act(() => {
      ws.onmessage!({ data: JSON.stringify(makeLog('info', 'paused msg')) })
    })

    expect(result.current.logs).toHaveLength(0)
  })

  it('resume allows receiving logs again', () => {
    const { result } = renderHook(() => useLogs())

    const ws = MockWS.instances[0]

    act(() => {
      result.current.pause()
    })

    act(() => {
      ws.onmessage!({ data: JSON.stringify(makeLog('info', 'paused msg')) })
    })

    expect(result.current.logs).toHaveLength(0)

    act(() => {
      result.current.resume()
    })

    act(() => {
      ws.onmessage!({ data: JSON.stringify(makeLog('info', 'resumed msg')) })
    })

    expect(result.current.logs).toHaveLength(1)
    expect(result.current.logs[0].msg).toBe('resumed msg')
  })

  it('clear empties the logs array', () => {
    const { result } = renderHook(() => useLogs())

    const ws = MockWS.instances[0]

    act(() => {
      ws.onmessage!({ data: JSON.stringify(makeLog('info', 'msg 1')) })
    })

    expect(result.current.logs).toHaveLength(1)

    act(() => {
      result.current.clear()
    })

    expect(result.current.logs).toHaveLength(0)
  })

  it('caps logs at 500 entries', () => {
    const { result } = renderHook(() => useLogs())

    const ws = MockWS.instances[0]

    act(() => {
      for (let i = 0; i < 510; i++) {
        ws.onmessage!({ data: JSON.stringify(makeLog('info', `msg ${i}`)) })
      }
    })

    expect(result.current.logs.length).toBeLessThanOrEqual(500)
  })

  it('closes WebSocket on unmount', () => {
    const { unmount } = renderHook(() => useLogs())

    const ws = MockWS.instances[0]
    unmount()

    expect(ws.readyState).toBe(3) // CLOSED
  })
})

describe('useLogs - lightweight summaries', () => {
  let MockWS: any

  beforeEach(() => {
    MockWS = (globalThis as any).WebSocket
    MockWS.reset()
  })

  afterEach(() => {
    MockWS.reset()
  })

  it('should parse request_started summary', () => {
    const { result } = renderHook(() => useLogs())

    const ws = MockWS.instances[0]

    act(() => {
      ws.onmessage!({ data: JSON.stringify({
        type: 'request_started',
        requestId: 'abc-123',
        method: 'POST',
        path: '/v1/chat'
      }) })
    })

    expect(result.current.logs).toHaveLength(1)
    expect(result.current.logs[0]).toEqual({
      type: 'request_started',
      requestId: 'abc-123',
      method: 'POST',
      path: '/v1/chat',
      level: 'info'
    })
  })

  it('should parse request_completed summary', () => {
    const { result } = renderHook(() => useLogs())

    const ws = MockWS.instances[0]

    act(() => {
      ws.onmessage!({ data: JSON.stringify({
        type: 'request_completed',
        requestId: 'abc-123',
        statusCode: 200,
        responseTime: 150
      }) })
    })

    expect(result.current.logs).toHaveLength(1)
    expect(result.current.logs[0]).toEqual({
      type: 'request_completed',
      requestId: 'abc-123',
      statusCode: 200,
      responseTime: 150,
      level: 'info'
    })
  })

  it('should mix traditional logs and summaries', () => {
    const { result } = renderHook(() => useLogs())

    const ws = MockWS.instances[0]

    act(() => {
      ws.onmessage!({ data: JSON.stringify(makeLog('info', 'proxy started')) })
      ws.onmessage!({ data: JSON.stringify({
        type: 'request_started',
        requestId: 'req-2',
        method: 'POST',
        path: '/v1/messages'
      }) })
    })

    expect(result.current.logs).toHaveLength(2)
    expect(result.current.logs[0].msg).toBe('proxy started')
    expect(result.current.logs[1].type).toBe('request_started')
  })

  it('should filter summaries by level', () => {
    const { result } = renderHook(() => useLogs({ level: 'error' }))

    const ws = MockWS.instances[0]

    act(() => {
      ws.onmessage!({ data: JSON.stringify({
        type: 'request_started',
        requestId: 'abc-123',
        method: 'POST',
        path: '/v1/chat'
      }) })
    })

    // request_started has level: 'info', should be filtered out
    expect(result.current.logs).toHaveLength(0)
  })

  it('should not filter summaries by grep (no msg field)', () => {
    const { result } = renderHook(() => useLogs({ grep: 'proxy' }))

    const ws = MockWS.instances[0]

    act(() => {
      ws.onmessage!({ data: JSON.stringify({
        type: 'request_started',
        requestId: 'abc-123',
        method: 'POST',
        path: '/v1/chat'
      }) })
    })

    // summaries don't have msg field, so grep filter should skip them
    expect(result.current.logs).toHaveLength(1)
  })
})

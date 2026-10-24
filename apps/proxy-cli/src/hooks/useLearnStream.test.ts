import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { createChatConnection } from '../api/chat'
import { useLearnStream } from './useLearnStream'

vi.mock('../api/chat', () => ({
  createChatConnection: vi.fn()
}))

const mockCreate = vi.mocked(createChatConnection)

// 每个连接都是可手动触发 onData/onSession/onDone 的假对象
const makeConn = () => ({
  abortController: new AbortController(),
  onSession: (_id: string) => {},
  onData: (_type: string, _data: any) => {},
  onError: (_msg: string) => {},
  onDone: () => {},
  abort: vi.fn()
})

describe('useLearnStream', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('starts a learn connection without sessionId', () => {
    const conn = makeConn()
    mockCreate.mockReturnValue(conn)
    const { result } = renderHook(() => useLearnStream())

    act(() => {
      result.current.start({ source: 'url', payload: 'https://x.com', label: 'X' })
    })

    expect(mockCreate).toHaveBeenCalledTimes(1)
    expect(mockCreate).toHaveBeenLastCalledWith('https://x.com', undefined, 'learn')
    expect(result.current.status).toBe('streaming')
    expect(result.current.stage).toBeNull()
  })

  it('followup switches to chat mode and does not reuse learn sessionId', () => {
    const learnConn = makeConn()
    mockCreate.mockReturnValue(learnConn)
    const { result } = renderHook(() => useLearnStream())

    act(() => {
      result.current.start({ source: 'url', payload: 'https://x.com' })
    })
    expect(mockCreate).toHaveBeenLastCalledWith('https://x.com', undefined, 'learn')

    // 后端下发 pi sessionId，流水线结束
    act(() => {
      learnConn.onSession('pi-abc')
    })
    act(() => {
      learnConn.onDone()
    })
    expect(result.current.status).toBe('done')

    const chatConn = makeConn()
    mockCreate.mockReturnValue(chatConn)

    act(() => {
      result.current.followup('什么是 X')
    })

    // 第三个参数必须是 'chat'，第二个参数必须是 undefined（不复用 learn sessionId）
    expect(mockCreate).toHaveBeenLastCalledWith('什么是 X', undefined, 'chat')
  })

  it('accumulates stage progress events across outline -> refine', () => {
    const conn = makeConn()
    mockCreate.mockReturnValue(conn)
    const { result } = renderHook(() => useLearnStream())

    act(() => {
      result.current.start({ source: 'url', payload: 'https://x.com' })
    })

    act(() => {
      conn.onData('stage_start', { type: 'stage_start', stage: 'outline' })
    })
    expect(result.current.stage).toEqual({ name: 'outline', index: 0, total: 0, failedCount: 0 })

    act(() => {
      conn.onData('stage_start', { type: 'stage_start', stage: 'refine', totalItems: 3 })
    })
    expect(result.current.stage).toEqual({ name: 'refine', index: 0, total: 3, failedCount: 0 })

    act(() => {
      conn.onData('stage_item_start', { type: 'stage_item_start', index: 0, total: 3, title: 'a' })
    })
    expect(result.current.stage).toMatchObject({ name: 'refine', index: 0 })

    act(() => {
      conn.onData('stage_item_end', { type: 'stage_item_end', index: 0, chunkId: 'c1' })
    })
    // item_end 不改 index
    expect(result.current.stage).toEqual({ name: 'refine', index: 0, total: 3, failedCount: 0 })

    act(() => {
      conn.onData('stage_item_failed', { type: 'stage_item_failed', index: 1, title: 'b', reason: 'err' })
    })
    expect(result.current.stage).toMatchObject({ failedCount: 1 })

    act(() => {
      conn.onData('stage_end', { type: 'stage_end', stage: 'refine' })
    })
    // stage_end 清进度
    expect(result.current.stage).toBeNull()
  })

  it('Finding 4：followup 两次，第二次复用第一次 chat 连接下发的 sessionId', () => {
    const learnConn = makeConn()
    mockCreate.mockReturnValue(learnConn)
    const { result } = renderHook(() => useLearnStream())

    act(() => {
      result.current.start({ source: 'url', payload: 'https://x.com' })
    })
    // learn 流水线结束（mode=learn）→ sessionId 被清空
    act(() => { learnConn.onSession('pi-learn-1') })
    act(() => { learnConn.onDone() })
    expect(result.current.status).toBe('done')

    // 第一次 followup：chat 模式，无 sessionId（learn 的已清）
    const chatConn1 = makeConn()
    mockCreate.mockReturnValue(chatConn1)
    act(() => { result.current.followup('什么是 useState?') })
    expect(mockCreate).toHaveBeenLastCalledWith('什么是 useState?', undefined, 'chat')

    // 后端新建 chat session 并下发 sessionId；chat 模式 done 不清 sessionId
    act(() => { chatConn1.onSession('pi-chat-1') })
    act(() => { chatConn1.onDone() })
    expect(result.current.status).toBe('done')

    // 第二次 followup：必须复用 pi-chat-1，保留多轮上下文
    const chatConn2 = makeConn()
    mockCreate.mockReturnValue(chatConn2)
    act(() => { result.current.followup('什么时候用它?') })
    expect(mockCreate).toHaveBeenLastCalledWith('什么时候用它?', 'pi-chat-1', 'chat')
  })

  it('resets stage when a new task starts', () => {
    const conn = makeConn()
    mockCreate.mockReturnValue(conn)
    const { result } = renderHook(() => useLearnStream())

    act(() => {
      result.current.start({ source: 'url', payload: 'https://x.com' })
    })
    act(() => {
      conn.onData('stage_start', { type: 'stage_start', stage: 'refine', totalItems: 2 })
    })
    expect(result.current.stage).toMatchObject({ name: 'refine' })

    act(() => {
      result.current.start({ source: 'url', payload: 'https://y.com' })
    })
    expect(result.current.stage).toBeNull()
  })
})

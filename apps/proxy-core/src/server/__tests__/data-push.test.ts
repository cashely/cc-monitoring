import { WebSocket } from 'ws'
import { addDataClient, removeDataClient, pushNewRequest } from '../data-push'

// 统计 fake client 收到的各类广播
function messagesOf(send: jest.Mock): any[] {
  return send.mock.calls.map((call) => JSON.parse(call[0]))
}

describe('data-push stats notify debounce', () => {
  let send: jest.Mock
  const fakeWs = {
    readyState: WebSocket.OPEN,
    send: jest.fn()
  } as unknown as WebSocket

  beforeEach(() => {
    jest.useFakeTimers()
    send = fakeWs.send as jest.Mock
    send.mockClear()
    addDataClient(fakeWs)
  })

  afterEach(() => {
    removeDataClient(fakeWs)
    jest.clearAllTimers()
    jest.useRealTimers()
  })

  it('trailing：重复 completed push 会重置延迟窗口，只在最后一次后 1.5s 广播一次', () => {
    // t=0 第一次 completed push
    pushNewRequest({ id: 1 }, 'completed')
    jest.advanceTimersByTime(1000)

    // t=1000 第二次 completed push，trailing 重置：窗口从第二次重新起算
    pushNewRequest({ id: 2 }, 'completed')

    // 距第二次 1499ms（总 2499ms）仍无 stats 广播；若没有重置，第一次的 timer 在 t=1500 就会触发
    jest.advanceTimersByTime(1499)
    expect(messagesOf(send).filter((m) => m.type === 'stats')).toHaveLength(0)

    // 总 2500ms（距第二次 1500ms）恰好广播一次
    jest.advanceTimersByTime(1)
    const statsMessages = messagesOf(send).filter((m) => m.type === 'stats')
    expect(statsMessages).toHaveLength(1)
    expect(statsMessages[0]).toEqual({ type: 'stats', action: 'notify' })
  })

  it('pending push 不产生 stats 广播', () => {
    pushNewRequest({ id: 1 }, 'pending')

    jest.advanceTimersByTime(5000)
    expect(messagesOf(send).filter((m) => m.type === 'stats')).toHaveLength(0)
  })
})

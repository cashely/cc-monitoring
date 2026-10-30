import { EventEmitter } from 'node:events'
import type { IncomingMessage } from 'node:http'
import { createClientAbortSignal, createTimeoutSignal, bindAbort } from '../abort-signals.js'

/** fake IncomingMessage：EventEmitter + 可写 aborted 字段 */
function fakeReq(aborted = false): IncomingMessage {
  const req = new EventEmitter() as unknown as IncomingMessage
  Object.defineProperty(req, 'aborted', { value: aborted, writable: true, configurable: true })
  return req
}

describe('createClientAbortSignal', () => {
  it('未 close 时 signal 不 abort', () => {
    expect(createClientAbortSignal(fakeReq()).aborted).toBe(false)
  })

  it('aborted=true 后 emit close → signal abort', () => {
    const req = fakeReq()
    const signal = createClientAbortSignal(req)
    ;(req as any).aborted = true
    req.emit('close')
    expect(signal.aborted).toBe(true)
  })

  it('正常结束（aborted=false emit close）不 abort', () => {
    const req = fakeReq()
    const signal = createClientAbortSignal(req)
    req.emit('close')
    expect(signal.aborted).toBe(false)
  })

  it('传入时已 aborted → 立即 abort', () => {
    expect(createClientAbortSignal(fakeReq(true)).aborted).toBe(true)
  })
})

describe('createTimeoutSignal', () => {
  it('外部 signal abort → 合成 signal 立即 abort，reason 取外部', () => {
    const ext = new AbortController()
    ext.abort(new Error('client gone'))
    const combined = createTimeoutSignal(300000, ext.signal)
    expect(combined.aborted).toBe(true)
    expect(combined.reason).toEqual(new Error('client gone'))
  })

  it('无外部 signal 时初始不 abort；超时后 abort（短 ms 实测）', async () => {
    const combined = createTimeoutSignal(20)
    expect(combined.aborted).toBe(false)
    await new Promise((r) => setTimeout(r, 40))
    expect(combined.aborted).toBe(true)
    expect(combined.reason.name).toBe('TimeoutError')
  })
})

describe('bindAbort', () => {
  it('source 未 abort 时不调；abort 后调一次', () => {
    const source = new AbortController()
    const abortFn = jest.fn(async () => {})
    bindAbort(source.signal, abortFn)
    expect(abortFn).not.toHaveBeenCalled()
    source.abort()
    expect(abortFn).toHaveBeenCalledTimes(1)
  })

  it('source 已 abort → 立即调', () => {
    const source = new AbortController()
    source.abort()
    const abortFn = jest.fn(async () => {})
    bindAbort(source.signal, abortFn)
    expect(abortFn).toHaveBeenCalledTimes(1)
  })

  it('abortFn reject 不外泄', () => {
    const source = new AbortController()
    bindAbort(source.signal, async () => { throw new Error('boom') })
    expect(() => source.abort()).not.toThrow()
  })
})

// AbortSignal 小工具：
// - createClientAbortSignal：下游 HTTP 连接客户端中止 → AbortSignal
// - createTimeoutSignal：固定超时 + 外部取消合成
// - bindAbort：source signal abort → 调 session.abort()
import type { IncomingMessage } from 'node:http'

/**
 * 监听 Node IncomingMessage，客户端在响应结束前中止连接时 abort 返回的 signal。
 * close 时以 req.aborted 区分：true=客户端侧中止；正常响应结束后的 close 为 false。
 */
export function createClientAbortSignal(req: IncomingMessage): AbortSignal {
  const controller = new AbortController()
  // 传入时已 aborted（或已 close 过）：立即 abort，不再依赖 close 事件
  if (req.aborted) {
    controller.abort()
    return controller.signal
  }
  req.on('close', () => {
    if (req.aborted) controller.abort()
  })
  return controller.signal
}

/** 合成：固定超时 + 外部取消，任意触发即 abort */
export function createTimeoutSignal(ms: number, external?: AbortSignal): AbortSignal {
  return AbortSignal.any([AbortSignal.timeout(ms), ...(external ? [external] : [])])
}

/**
 * 把 source signal 接到 abortFn：source 已 abort 立即调，否则将来 abort 时调一次。
 * abortFn 异步拒绝不外泄（由调用方保证幂等）。
 */
export function bindAbort(source: AbortSignal, abortFn: () => Promise<void>): void {
  if (source.aborted) {
    abortFn().catch(() => {})
  } else {
    source.addEventListener('abort', () => abortFn().catch(() => {}), { once: true })
  }
}

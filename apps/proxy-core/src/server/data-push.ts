import { WebSocket } from 'ws'

// Global connection pool
const dataClients = new Set<WebSocket>()

export function addDataClient(ws: WebSocket): void {
  dataClients.add(ws)
}

export function removeDataClient(ws: WebSocket): void {
  dataClients.delete(ws)
}

export function getDataClientCount(): number {
  return dataClients.size
}

// stats notify debounce timer（模块级单个，trailing：重复调用重置延迟）
let statsNotifyTimer: ReturnType<typeof setTimeout> | null = null

// 请求终态后延迟广播一次 stats notify，并发终态合并为一次
export function scheduleStatsNotify(delayMs = 1500): void {
  if (statsNotifyTimer) clearTimeout(statsNotifyTimer)
  statsNotifyTimer = setTimeout(() => {
    statsNotifyTimer = null
    broadcast({ type: 'stats', action: 'notify' })
  }, delayMs)
}

// 服务关闭时清理 pending 的 debounce timer
export function clearStatsNotify(): void {
  if (statsNotifyTimer) {
    clearTimeout(statsNotifyTimer)
    statsNotifyTimer = null
  }
}

// Broadcast helpers
export function pushNewRequest(summary: any, status: 'pending' | 'completed' = 'completed'): void {
  broadcast({
    type: 'request',
    action: status === 'pending' ? 'new' : 'update',
    data: { ...summary, status }
  })
  // 终态（complete/interrupt/error）后通知前端重取 stats；pending=请求开始不触发
  if (status !== 'pending') {
    scheduleStatsNotify()
  }
}

function broadcast(msg: any): void {
  const payload = JSON.stringify(msg)
  for (const ws of dataClients) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(payload)
    }
  }
}

// Expose broadcast for global status timer (ui-route.ts)
export function broadcastToDataClients(msg: any): void {
  broadcast(msg)
}

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

// Broadcast helpers
export function pushNewRequest(summary: any, status: 'pending' | 'completed' = 'completed'): void {
  broadcast({
    type: 'request',
    action: status === 'pending' ? 'new' : 'update',
    data: { ...summary, status }
  })
}

export function pushStatsNotify(): void {
  broadcast({
    type: 'stats',
    action: 'notify',
    data: { reason: 'file_updated' }
  })
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

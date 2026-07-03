import net from 'net'

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// 单次 TCP 连接探测：能建立连接即视为端口在监听
function tryConnect(host: string, port: number, timeout = 1000): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port })
    let settled = false
    const done = (ok: boolean) => {
      if (settled) return
      settled = true
      socket.destroy()
      resolve(ok)
    }
    socket.setTimeout(timeout)
    socket.once('connect', () => done(true))
    socket.once('timeout', () => done(false))
    socket.once('error', () => done(false))
  })
}

/**
 * 递增退避端口探测：共 5 次，每次尝试前等待 1s→2s→3s→4s→5s（累计约 15s）。
 * 探测到端口监听即返回 true；5 次均失败返回 false。
 * host 为 0.0.0.0 / :: / 空时探测回环地址 127.0.0.1。
 */
export async function waitForPort(
  host: string,
  port: number,
  onAttempt?: (attempt: number, max: number) => void
): Promise<boolean> {
  const target = !host || host === '0.0.0.0' || host === '::' ? '127.0.0.1' : host
  const MAX_ATTEMPTS = 5
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    await sleep(attempt * 1000)
    onAttempt?.(attempt, MAX_ATTEMPTS)
    if (await tryConnect(target, port)) return true
  }
  return false
}

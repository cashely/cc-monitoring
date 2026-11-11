import { createRequire } from 'module'
import type { Pm2ProcessStatus } from '../types/pm2.js'
import { getCurrentModuleUrl } from './esm-dirname.js'

// PM2 is a CJS package, use createRequire for ESM compatibility.
// getCurrentModuleUrl() wraps import.meta.url so this file has no bare
// import.meta syntax (which fails to parse under ts-jest's CJS compilation).
const requireCjs: NodeRequire = (() => {
  try {
    return createRequire(getCurrentModuleUrl())
  } catch {
    return require
  }
})()
const pm2 = requireCjs('pm2') as any

async function pm2Connect(): Promise<void> {
  return new Promise((resolve, reject) => {
    pm2.connect((err: Error | null) => {
      if (err) reject(err)
      else resolve()
    })
  })
}

// 模块级懒加载单例：复用同一条 pm2 RPC 连接，避免每个操作都
// connect/disconnect 触发 pm2 竞态（disconnect 后 axon connect 事件
// 才到达时 self.client 已为 null）。
let connectPromise: Promise<void> | null = null

function getConnection(): Promise<void> {
  if (!connectPromise) {
    connectPromise = pm2Connect().catch((err) => {
      // 连接失败时允许下次调用重新尝试，同时不吞掉 reject
      connectPromise = null
      throw err
    })
  }
  return connectPromise
}

async function pm2Disconnect(): Promise<void> {
  return new Promise((resolve) => {
    pm2.disconnect()
    resolve()
  })
}

async function pm2Start(options: string | object): Promise<void> {
  return new Promise((resolve, reject) => {
    pm2.start(options, (err: Error | Error[] | null) => {
      if (err) {
        // PM2 sometimes returns an array of errors
        const error = Array.isArray(err)
          ? new Error(err.map(e => e.message).join('; '))
          : err
        reject(error)
      } else resolve()
    })
  })
}

async function pm2Stop(name: string): Promise<void> {
  return new Promise((resolve, reject) => {
    pm2.stop(name, (err: Error | null) => {
      if (err) reject(err)
      else resolve()
    })
  })
}

async function pm2Delete(name: string): Promise<void> {
  return new Promise((resolve, reject) => {
    pm2.delete(name, (err: Error | null) => {
      if (err) reject(err)
      else resolve()
    })
  })
}

async function pm2Reload(name: string): Promise<void> {
  return new Promise((resolve, reject) => {
    pm2.reload(name, (err: Error | null) => {
      if (err) reject(err)
      else resolve()
    })
  })
}

async function pm2List(): Promise<any[]> {
  return new Promise((resolve, reject) => {
    pm2.list((err: Error | null, list: any[]) => {
      if (err) reject(err)
      else resolve(list)
    })
  })
}

export async function startProcess(ecosystemPath: string): Promise<void> {
  await getConnection()
  await pm2Start(ecosystemPath)
}

export async function stopProcess(name: string): Promise<void> {
  await getConnection()
  await pm2Stop(name)
}

export async function killProcess(name: string): Promise<void> {
  await getConnection()
  await pm2Delete(name)
}

export async function reloadProcess(name: string): Promise<void> {
  await getConnection()
  await pm2Reload(name)
}

// 服务器关闭时断开共享的 pm2 连接
export async function disconnectPm2(): Promise<void> {
  if (!connectPromise) return
  await pm2Disconnect()
  connectPromise = null
}

// 轮询 pm2 list，直到目标进程状态为 online 或超时
export async function waitForOnline(name: string, timeoutMs = 8000, intervalMs = 300): Promise<boolean> {
  await getConnection()
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const list = await pm2List()
    const proc = list.find(p => p.name === name)
    if (proc?.pm2_env?.status === 'online') return true
    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }
  return false
}

export async function getProcessStatus(name: string): Promise<Pm2ProcessStatus | null> {
  await getConnection()
  const list = await pm2List()

  const proc = list.find(p => p.name === name)
  if (!proc) return null

  return {
    name: proc.name ?? name,
    status: (proc.pm2_env?.status ?? 'stopped') as Pm2ProcessStatus['status'],
    cpu: proc.monit?.cpu ?? 0,
    memory: proc.monit?.memory ?? 0,
    uptime: proc.pm2_env?.pm_uptime ?? 0,
    restarts: proc.pm2_env?.restart_time ?? 0
  }
}
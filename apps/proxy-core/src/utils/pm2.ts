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
  await pm2Connect()
  await pm2Start(ecosystemPath)
  await pm2Disconnect()
}

export async function stopProcess(name: string): Promise<void> {
  await pm2Connect()
  await pm2Stop(name)
  await pm2Disconnect()
}

export async function reloadProcess(name: string): Promise<void> {
  await pm2Connect()
  await pm2Reload(name)
  await pm2Disconnect()
}

export async function getProcessStatus(name: string): Promise<Pm2ProcessStatus | null> {
  await pm2Connect()
  const list = await pm2List()
  await pm2Disconnect()

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
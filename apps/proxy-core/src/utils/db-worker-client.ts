import { Worker } from 'node:worker_threads'
import { fileURLToPath } from 'node:url'
import { existsSync } from 'node:fs'

// 主线程侧 DB worker 客户端：requests / response_events / stats 三表的全部读写
// 都通过 postMessage 送到单个 worker 线程顺序执行，避免阻塞主事件循环。

interface PendingCall {
  resolve: (value: any) => void
  reject: (error: any) => void
}

interface WorkerResponse {
  id: number
  ok: boolean
  value?: any
  error?: string
}

let worker: Worker | null = null
let nextId = 1
const pending = new Map<number, PendingCall>()

export function startDbWorker(absPath: string): void {
  if (worker) return

  // 生产：同目录编译产物 db-worker-thread.js；直跑 .ts 源码（jest / tsx dev）时
  // 编译产物不存在，改用 .ts 源文件并在 worker 内注册 tsx 加载器。
  let workerFile = fileURLToPath(new URL('./db-worker-thread.js', import.meta.url))
  let execArgv: string[] | undefined
  if (!existsSync(workerFile)) {
    const tsFile = workerFile.replace(/\.js$/, '.ts')
    if (existsSync(tsFile)) {
      workerFile = tsFile
      execArgv = ['--import', 'tsx']
    }
  }

  worker = new Worker(workerFile, { workerData: { dbPath: absPath }, execArgv })

  worker.on('message', (msg: WorkerResponse) => {
    const entry = pending.get(msg.id)
    if (!entry) return
    pending.delete(msg.id)
    if (msg.ok) {
      entry.resolve(msg.value)
    } else {
      entry.reject(new Error(msg.error || 'db worker call failed'))
    }
  })

  worker.on('error', err => {
    worker = null
    for (const entry of pending.values()) entry.reject(err)
    pending.clear()
  })
}

export function dbCall<T = any>(action: string, payload?: any): Promise<T> {
  if (!worker) {
    return Promise.reject(new Error('DB worker not started. Call startDbWorker() first.'))
  }
  const id = nextId++
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve, reject })
    worker!.postMessage({ id, action, payload })
  })
}

// 优雅停止：meta.stop 排在队列末尾，worker 处理完此前所有消息后关闭连接并退出，
// 未决回调（异常残留）在 exit 时统一 reject。
export function stopDbWorker(): Promise<void> {
  if (!worker) return Promise.resolve()
  const w = worker
  worker = null

  return new Promise<void>(resolve => {
    w.once('exit', () => {
      for (const [id, entry] of pending) {
        pending.delete(id)
        entry.reject(new Error('DB worker stopped'))
      }
      resolve()
    })
    w.postMessage({ id: 0, action: 'meta.stop' })
  })
}

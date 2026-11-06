import { spawn } from 'node:child_process'

/**
 * 统一封装 ego-browser CLI：spawn 子进程 + 写入 Node 脚本 stdin，返回 cliLog 文本。
 * 每次调用独立进程，靠 useOrCreateTaskSpace 在同一 task space 复用 tab。
 */
export function runEgoBrowser(
  scriptBody: string,
  opts: { timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<string> {
  const timeoutMs = opts.timeoutMs ?? 30_000
  return new Promise((resolve, reject) => {
    // 头部自动注入 task space 复用调用
    const script = `const task = await taskSpace('knowledge-learn')\n${scriptBody}`

    const child = spawn('ego-browser', ['nodejs'], {
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    let stdout = ''
    let stderr = ''
    let settled = false

    const finish = (err: Error | null, out?: string) => {
      if (settled) return
      settled = true
      cleanup()
      if (err) {
        // 把 stderr 附加到错误里，帮助排查
        const detail = stderr.trim() ? `\n--- stderr ---\n${stderr.trim()}` : ''
        reject(new Error(`${err.message}${detail}`))
      } else {
        resolve(out ?? stdout)
      }
    }

    const timer = setTimeout(() => {
      finish(new Error(`ego-browser timed out after ${timeoutMs}ms`))
      child.kill('SIGKILL')
    }, timeoutMs)

    const onAbort = () => {
      finish(new Error('ego-browser aborted'))
      child.kill('SIGKILL')
    }
    opts.signal?.addEventListener('abort', onAbort, { once: true })

    const cleanup = () => {
      clearTimeout(timer)
      opts.signal?.removeEventListener('abort', onAbort)
    }

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf-8')
    })
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf-8')
    })

    child.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'ENOENT') {
        finish(new Error('ego-browser CLI not found. Please install ego-browser first.'))
      } else {
        finish(err instanceof Error ? err : new Error(String(err)))
      }
    })

    child.on('close', (code) => {
      if (settled) return
      if (code === 0) {
        // 新版 ego cliLog 走 stderr；stdout 非空用 stdout，否则回退 stderr（新旧兼容）
        const out = stripCliBanners(stdout.trim() ? stdout : stderr)
        finish(null, out)
      } else {
        // 非 0 退出：stderr 可能含错误；stdout 仍作为错误消息的一部分返回
        const detail = stdout.trim() ? `\n--- stdout ---\n${stdout.trim()}` : ''
        finish(new Error(`ego-browser exited with code ${code}${detail}`))
      }
    })

    child.stdin.end(script, 'utf-8')
  })
}

/** 过滤 ego-browser 自身打到输出流的横幅行（如升级 notice），保留脚本 cliLog 的真实输出 */
export function stripCliBanners(text: string): string {
  return text
    .split('\n')
    .filter((line) => !line.startsWith('[ego-browser:notice]'))
    .join('\n')
}

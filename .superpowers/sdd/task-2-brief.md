### Task 2: Server exec endpoint 扩展 — sessionId 支持

**Files:**
- Modify: `apps/proxy-core/src/server/ui-route.ts:19-30,234-373`

**Interfaces:**
- Consumes: none
- Produces:
  - `ExecRequestBody.sessionId?: string` — 前端 Task 3/4 使用
  - `ExecResponse.sessionId?: string` — 前端 Task 4 使用
  - SSE `session` event — 前端 Task 4 的 `useChat` hook 消费
  - SSE `data` event JSON `{ type: 'stdout'|'stderr', content: string }` — 前端 Task 4 消费

- [ ] **Step 1: 扩展 ExecRequestBody 和 ExecResponse 类型**

在 `apps/proxy-core/src/server/ui-route.ts` 修改类型定义（行19-30）：

```typescript
// Exec API types
interface ExecRequestBody {
  tool: 'claude'
  prompt: string
  stream?: boolean
  sessionId?: string  // 新增：claude 会话 ID，用于多轮对话
}

interface ExecResponse {
  success: boolean
  output?: string
  error?: string
  sessionId?: string  // 新增：server 生成的会话 UUID
}
```

- [ ] **Step 2: 修改 stream 模式的 spawn 命令和 SSE 逻辑**

修改 `/ui/api/exec` stream 模式部分（行258-318）。整体替换如下：

```typescript
if (stream) {
  // Streaming mode: use SSE
  const newSessionId = sessionId ?? crypto.randomUUID()

  reply.hijack()
  const res = reply.raw
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive'
  })

  const sendSSE = (event: string, data: string) => {
    if (res.destroyed) return
    res.write(`event: ${event}\ndata: ${data}\n\n`)
  }

  // 新对话时发送 session event
  if (!sessionId) {
    sendSSE('session', newSessionId)
  }

  const spawnArgs = sessionId
    ? ['-r', sessionId, '-p', prompt]
    : ['--session-id', newSessionId, '-p', prompt]

  const child = spawn('claude', spawnArgs, {
    env: { ...process.env }
  })

  const TIMEOUT = 5 * 60 * 1000 // 5 minutes
  const timeoutId = setTimeout(() => {
    child.kill('SIGTERM')
    if (!res.destroyed) {
      sendSSE('error', JSON.stringify({ message: 'Execution timeout (5 minutes)' }))
      sendSSE('done', JSON.stringify({ code: 1 }))
      res.end()
    }
  }, TIMEOUT)

  child.stdout?.on('data', (chunk) => {
    sendSSE('data', JSON.stringify({ type: 'stdout', content: chunk.toString() }))
  })

  child.stderr?.on('data', (chunk) => {
    sendSSE('data', JSON.stringify({ type: 'stderr', content: chunk.toString() }))
  })

  child.on('error', (err) => {
    clearTimeout(timeoutId)
    if (!res.destroyed) {
      sendSSE('error', JSON.stringify({ message: err.message }))
      sendSSE('done', JSON.stringify({ code: 1 }))
      res.end()
    }
  })

  child.on('close', (code) => {
    clearTimeout(timeoutId)
    if (!res.destroyed) {
      sendSSE('done', JSON.stringify({ code: code ?? 0 }))
      res.end()
    }
  })

  // Handle client disconnect
  res.on('close', () => {
    clearTimeout(timeoutId)
    if (!child.killed) {
      child.kill('SIGTERM')
    }
  })
}
```

- [ ] **Step 3: 修改非 stream 模式**

修改非 stream 部分（行319-372）。替换整体：

```typescript
} else {
  // Non-streaming mode: buffer all output
  const newSessionId = sessionId ?? crypto.randomUUID()

  const spawnArgs = sessionId
    ? ['-r', sessionId, '-p', prompt]
    : ['--session-id', newSessionId, '-p', prompt]

  const child = spawn('claude', spawnArgs, {
    env: { ...process.env }
  })

  const TIMEOUT = 5 * 60 * 1000 // 5 minutes
  const timeoutId = setTimeout(() => {
    child.kill('SIGTERM')
  }, TIMEOUT)

  let stdout = ''
  let stderr = ''

  child.stdout?.on('data', (chunk) => {
    stdout += chunk.toString()
  })

  child.stderr?.on('data', (chunk) => {
    stderr += chunk.toString()
  })

  const result: ExecResponse = await new Promise((resolve) => {
    child.on('error', (err) => {
      clearTimeout(timeoutId)
      resolve({
        success: false,
        error: err.message
      })
    })

    child.on('close', (code) => {
      clearTimeout(timeoutId)
      const output = stdout + stderr
      if (code === 0) {
        resolve({
          success: true,
          output,
          sessionId: newSessionId
        })
      } else {
        resolve({
          success: false,
          error: output || `Process exited with code ${code}`,
          sessionId: newSessionId
        })
      }
    })
  })

  if (!result.success) {
    return reply.code(500).send(result)
  }

  return result
}
```

- [ ] **Step 4: 更新请求体解构**

修改行242，从 `request.body` 解构新增 `sessionId`：

```typescript
const { tool, prompt, stream = false, sessionId } = request.body
```

- [ ] **Step 5: 构建验证**

```bash
cd /Users/cashely.shi/Documents/projects/cc-monitoring
pnpm build:proxy-core
```

Expected: 构建成功，无 TS 错误

- [ ] **Step 6: Commit**

```bash
git add apps/proxy-core/src/server/ui-route.ts
git commit -m "feat: extend exec endpoint with sessionId support for multi-turn chat"
```

---


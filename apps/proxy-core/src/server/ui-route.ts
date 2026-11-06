import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import staticPlugin from '@fastify/static'
import path from 'path'
import fs from 'fs'
import { WebSocketServer, WebSocket } from 'ws'
import { randomUUID } from 'node:crypto'
import { loadConfig, saveConfig } from '../config/index.js'
import { getProcessStatus, startProcess, stopProcess, reloadProcess } from '../utils/pm2.js'
import { getCallerDirname } from '../utils/esm-dirname.js'
import { getConfigPath, getDisplayPath } from '../utils/paths.js'
import { loadRequestDB, listRequestDB, type RequestSummary } from '../utils/request-writer.js'
import { createPiSession, type PiSessionMode } from '../utils/pi-runtime.js'
import { runLearnPipeline, type LearnPipelineEvents } from '../utils/pi-learn-orchestrator.js'
import type { AgentSession } from '@earendil-works/pi-coding-agent'
import { statusHistory } from '../utils/status-history.js'
import { addDataClient, removeDataClient, pushStatsNotify, broadcastToDataClients, getDataClientCount } from './data-push.js'
import { getVersionInfo } from '../utils/version.js'
import { getStatsData, getTodayStats } from '../utils/stats-aggregator.js'
import { setupProvidersRoutes } from './providers-route.js'
import { setupMcpRoutes } from './mcp-route.js'
import { setupClaudeSettingsRoutes } from './claude-settings-route.js'
import { checkAuth } from './auth.js'
import { encodeSSEFrame } from '../utils/sse-protocol.js'
import { createClientAbortSignal } from '../utils/abort-signals.js'
import { createPiEventEmitter } from '../utils/pi-events.js'
import { getDatabase } from '../utils/db.js'
import { insertRunning, markCompleted, markFailed, markAborted } from '../utils/learn-tasks-db.js'

// 同 slug running 唯一守卫撞约束：better-sqlite3 暴露扩展错误码，message 兜底
function isLearnRunningConstraint(err: any): boolean {
  return err?.code === 'SQLITE_CONSTRAINT_UNIQUE'
    || (typeof err?.message === 'string' && /UNIQUE constraint failed/i.test(err.message))
}

// Exec API types
interface ExecRequestBody {
  tool?: string
  prompt: string
  stream?: boolean
  sessionId?: string  // pi 会话 ID，用于多轮对话
  mode?: 'chat' | 'learn'  // 会话模式：chat=pi 多轮问答，learn=三阶段学习流水线（orchestrator），默认 chat
  thinkingLevel?: 'off' | 'minimal' | 'low' | 'medium' | 'high'
}

interface ExecResponse {
  success: boolean
  output?: string
  error?: string
  sessionId?: string  // server 生成的会话 UUID
}

export async function setupUiRoutes(fastify: FastifyInstance): Promise<void> {
  // Health check: Claude Code probes base URL with HEAD/GET /
  fastify.head('/', async () => '')
  fastify.get('/', async (_req: FastifyRequest, reply: FastifyReply) => reply.redirect('/ui'))

  const config = await loadConfig()

  // Mount providers API routes
  await setupProvidersRoutes(fastify, config)

  // Mount MCP server management routes
  await setupMcpRoutes(fastify, config)

  // Mount Claude settings sync route
  await setupClaudeSettingsRoutes(fastify, config)

  // Create WebSocket server for log streaming (bypass @fastify/websocket issues)
  const wss = new WebSocketServer({ noServer: true })

  // WebSocket server for data push (status/requests/stats)
  const dataWss = new WebSocketServer({ noServer: true })

  // Handle WebSocket upgrade for both log and data channels
  fastify.server.on('upgrade', (request, socket, head) => {
    if (request.url === '/ui/api/logs/stream') {
      wss.handleUpgrade(request, socket, head, (ws) => {
        handleLogStream(ws, config)
      })
    }
    if (request.url === '/ui/api/ws') {
      dataWss.handleUpgrade(request, socket, head, (ws) => {
        handleDataStream(ws)
      })
    }
  })

  fastify.get('/ui/api/status', async (request, reply) => {
    const status = await getProcessStatus('cc-monitoring')

    return {
      status: status?.status ?? 'stopped',
      cpu: status?.cpu ?? 0,
      memory: status?.memory ?? 0,
      uptime: status?.uptime ?? 0,
      restarts: status?.restarts ?? 0
    }
  })

  fastify.get<{ Querystring: { duration?: string } }>('/ui/api/status/history', async (request, reply) => {
    const durationMs = Number(request.query.duration) || 3600000
    return { history: statusHistory.getHistory(durationMs) }
  })

  fastify.get('/ui/api/config', async (request, reply) => {
    const cfg = await loadConfig()
    const versions = getVersionInfo()
    return { config: cfg, versions, configPath: getDisplayPath(getConfigPath()) }
  })

  fastify.post<{ Body: { reload?: boolean } }>('/ui/api/config', async (request, reply) => {
    if (!checkAuth(request, config)) {
      return reply.code(401).send({
        success: false,
        error: 'Unauthorized: missing or invalid Authorization header'
      })
    }

    const { reload, ...configData } = request.body
    const result = (await import('../config/schema.js')).validateConfig(configData)
    if (!result.valid) {
      return reply.code(400).send({
        success: false,
        errors: result.errors
      })
    }

    try {
      await saveConfig(result.data!)

      // 如果请求了重载，延迟5秒后重载进程（先返回响应）
      if (reload) {
        const status = await getProcessStatus('cc-monitoring')
        if (status && status.status === 'online') {
          // 延迟重启，避免中断响应
          setTimeout(async () => {
            try {
              await reloadProcess('cc-monitoring')
            } catch (err: any) {
              request.log.error({ err }, 'Delayed reload failed')
            }
          }, 5000)

          return { success: true, reloaded: true, restartingIn: 5000 }
        }
      }

      return { success: true, reloaded: false }
    } catch (err: any) {
      request.log.error({ err }, 'Failed to save config')
      return reply.code(500).send({
        success: false,
        error: err.message || 'Failed to save configuration'
      })
    }
  })

  // REST endpoint for loading saved request/response files
  fastify.get<{ Params: { id: string } }>('/ui/api/requests/:id', async (request, reply) => {
    try {
      const data = await loadRequestDB(request.params.id)
      return data
    } catch (err: any) {
      request.log.error({ err }, 'Failed to load request file')
      return reply.code(404).send({
        error: 'Request not found',
        requestId: request.params.id
      })
    }
  })

  // REST endpoint for listing all saved requests (summary) with cursor pagination
  fastify.get<{ Querystring: { limit?: string; before?: string } }>('/ui/api/requests', async (request, reply) => {
    try {
      const limit = request.query.limit ? Math.max(1, Number(request.query.limit) || 100) : 100
      const before = request.query.before
      // Validate before is a valid ISO string if provided
      if (before && Number.isNaN(new Date(before).getTime())) {
        return reply.code(400).send({
          error: 'Invalid before parameter: must be a valid ISO timestamp'
        })
      }
      const result = await listRequestDB(limit, before)
      return result
    } catch (err: any) {
      request.log.error({ err }, 'Failed to list request files')
      return reply.code(500).send({
        error: 'Failed to list requests',
        details: err.message
      })
    }
  })

  // REST endpoint for token aggregation stats (SQLite).
  // Optional `since` query param: ISO UTC string, limits hourly entries returned.
  fastify.get<{ Querystring: { since?: string } }>('/ui/api/stats', async (request, reply) => {
    try {
      const since = request.query.since
      return getStatsData(since)
    } catch (err: any) {
      request.log.error({ err }, 'Failed to load stats from database')
      return reply.code(500).send({
        error: 'Failed to load stats',
        details: err.message
      })
    }
  })

  // REST endpoint for today's real-time stats (direct query, no aggregation delay).
  // `since` = client's local midnight (ISO); falls back to server local midnight if absent.
  fastify.get('/ui/api/stats/today', async (request, reply) => {
    try {
      const sinceParam = (request.query as { since?: string })?.since
      let since = sinceParam
      if (!since || Number.isNaN(new Date(since).getTime())) {
        const midnight = new Date()
        midnight.setHours(0, 0, 0, 0)
        since = midnight.toISOString()
      }
      return getTodayStats(since)
    } catch (err: any) {
      request.log.error({ err }, 'Failed to load today stats from database')
      return reply.code(500).send({
        error: 'Failed to load today stats',
        details: err.message
      })
    }
  })

  // Process control endpoint (start/stop/restart)
  fastify.post<{ Body: { action: 'start' | 'stop' | 'restart' } }>('/ui/api/control', async (request, reply) => {
    if (!checkAuth(request, config)) {
      return reply.code(401).send({
        success: false,
        error: 'Unauthorized: missing or invalid Authorization header'
      })
    }

    const { action } = request.body
    const serverDirname = getCallerDirname('../server')
    const ecosystemPath = path.join(serverDirname, '..', '..', 'ecosystem.config.cjs')

    try {
      if (action === 'start') {
        await startProcess(ecosystemPath)
      } else if (action === 'stop') {
        await stopProcess('cc-monitoring')
      } else if (action === 'restart') {
        // 先返回响应，延迟1秒后再执行重启，让接口有时间返回
        setTimeout(async () => {
          try {
            await reloadProcess('cc-monitoring')
          } catch (err: any) {
            request.log.error({ err }, 'Delayed restart failed')
          }
        }, 1000)
        return { success: true, restartingIn: 1000 }
      } else {
        return reply.code(400).send({ success: false, error: 'Invalid action' })
      }

      return { success: true }
    } catch (err: any) {
      request.log.error({ err }, `Failed to ${action} process`)
      return reply.code(500).send({
        success: false,
        error: err.message || `Failed to ${action} process`
      })
    }
  })

  // pi AgentSession 进程内注册表：key = sessionId（pi 自己生成）
  const piSessions = new Map<string, AgentSession>()

  // learn 流水线非流式调用时的空事件桩（不订阅任何 SSE）
  const noopLearnEvents: LearnPipelineEvents = {
    stageStart: () => {},
    stageItemStart: () => {},
    stageItemEnd: () => {},
    stageItemFailed: () => {},
    stageEnd: () => {},
    roundStart: () => {},
    roundEnd: () => {},
    textDelta: () => {},
    thinkingDelta: () => {},
    toolStart: () => {},
    toolEnd: () => {},
  }

  // Exec endpoint: 通过嵌入的 pi SDK 跑 prompt，保持原 SSE/JSON 契约
  fastify.post<{ Body: ExecRequestBody }>('/ui/api/exec', async (request, reply) => {
    if (!checkAuth(request, config)) {
      return reply.code(401).send({
        success: false,
        error: 'Unauthorized: missing or invalid Authorization header'
      })
    }

    const { prompt, stream = false, sessionId, mode } = request.body

    if (!prompt || typeof prompt !== 'string' || prompt.trim().length === 0) {
      return reply.code(400).send({
        success: false,
        error: 'prompt is required and must be a non-empty string'
      })
    }

    const port = config.server.port

    // 'learn' 走 orchestrator 一次性流水线（不驻留 pi session，不进 piSessions 注册表）。
    // 其余值（含 outline/refine/tag）一律按 chat 处理：这些是内部 stage mode，不对外暴露。
    if (mode === 'learn') {
      // 本路由 body 无 Fastify JSON schema（仅 TS 类型），直接读取；非法 sourceType 一律按 url
      const sourceType: 'url' | 'file' = (request.body as any).sourceType === 'file' ? 'file' : 'url'
      const label: string | undefined = (request.body as any).label ?? undefined

      if (!stream) {
        // 非流式：跑完流水线，返回汇总（不返回 output 文本——流水线产物落盘）
        // 客户端在响应返回前断开 → abort 流水线
        const signal = createClientAbortSignal(request.raw)
        const db = getDatabase()
        let taskId: string | undefined
        try {
          const result = await runLearnPipeline({
            sourceType, input: prompt, label, port, events: noopLearnEvents, signal,
            onStart: (slug) => {
              const r = insertRunning(db, { slug, sourceType, label: label ?? (sourceType === 'url' ? prompt : 'topic') })
              taskId = r.taskId
            },
          })
          if (taskId) markCompleted(db, taskId)
          return {
            success: true,
            output: `slug=${result.slug} chunks=${result.chunksWritten} failed=${result.itemsFailed}`,
          }
        } catch (err: any) {
          request.log.error({ err }, 'learn pipeline failed')
          if (isLearnRunningConstraint(err)) {
            return reply.code(409).send({
              success: false,
              error: '已有同主题的学习任务在运行，请等待其结束后再试',
            })
          }
          if (taskId) {
            if (signal.aborted) markAborted(db, taskId)
            else markFailed(db, taskId, err?.message || 'learn pipeline failed')
          }
          return reply.code(500).send({
            success: false,
            error: err?.message || 'learn pipeline failed',
          })
        }
      }

      // Streaming: SSE
      reply.hijack()
      const res = reply.raw
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        // learn 流水线不驻留 session，前端 followup 走 chat，此 header 置空即可
        'x-claude-code-session-id': '',
      })

      const sendSSE = (event: string, data: string) => {
        if (res.destroyed) return
        res.write(encodeSSEFrame({ event, data }))
      }

      let finished = false
      const finish = (code: number) => {
        if (finished) return
        finished = true
        if (!res.destroyed) {
          sendSSE('done', JSON.stringify({ code }))
          res.end()
        }
      }

      // SSE adapter: LearnPipelineEvents → SSE data events。
      // 轮次由 orchestrator 按 assistant 交互驱动，这里直接透传 roundStart/roundEnd。
      const events: LearnPipelineEvents = {
        stageStart: (stage, totalItems) =>
          sendSSE('data', JSON.stringify({ type: 'stage_start', stage, totalItems })),
        stageItemStart: (index, total, title) =>
          sendSSE('data', JSON.stringify({ type: 'stage_item_start', index, total, title })),
        stageItemEnd: (index, chunkId) =>
          sendSSE('data', JSON.stringify({ type: 'stage_item_end', index, chunkId })),
        stageItemFailed: (index, title, reason) =>
          sendSSE('data', JSON.stringify({ type: 'stage_item_failed', index, title, reason })),
        stageEnd: (stage) =>
          sendSSE('data', JSON.stringify({ type: 'stage_end', stage })),
        roundStart: (roundIndex) =>
          sendSSE('data', JSON.stringify({ type: 'round_start', roundIndex })),
        roundEnd: (roundIndex) =>
          sendSSE('data', JSON.stringify({ type: 'round_end', roundIndex })),
        textDelta: (delta) =>
          sendSSE('data', JSON.stringify({ type: 'text_delta', content: delta })),
        thinkingDelta: (delta) =>
          sendSSE('data', JSON.stringify({ type: 'thinking_delta', content: delta })),
        toolStart: (e) =>
          sendSSE('data', JSON.stringify({
            type: 'tool_start',
            toolCallId: e.toolCallId,
            toolName: e.toolName,
            args: e.args,
          })),
        toolEnd: (e) =>
          sendSSE('data', JSON.stringify({
            type: 'tool_end',
            toolCallId: e.toolCallId,
            toolName: e.toolName,
            isError: e.isError,
            durationMs: e.durationMs,
            result: e.result,
          })),
      }

      // 通道关闭（关窗/客户端中止）→ abort 流水线，各阶段经 session.abort() 真取消
      const learnController = new AbortController()
      res.on('close', () => {
        learnController.abort()
      })

      const db = getDatabase()
      let taskId: string | undefined

      try {
        await runLearnPipeline({
          sourceType, input: prompt, label, port, events, signal: learnController.signal,
          onStart: (slug) => {
            const r = insertRunning(db, { slug, sourceType, label: label ?? (sourceType === 'url' ? prompt : 'topic') })
            taskId = r.taskId
          },
        })
        if (taskId) markCompleted(db, taskId)
        finish(0)
      } catch (err: any) {
        request.log.error({ err }, 'learn pipeline failed')
        if (isLearnRunningConstraint(err)) {
          // onStart 撞约束时流水线尚未做任何文件改动，无 taskId 不标终态
          if (!res.destroyed) {
            sendSSE('error', JSON.stringify({ message: '已有同主题的学习任务在运行，请等待其结束后再试' }))
          }
          finish(1)
          return
        }
        if (taskId) {
          if (learnController.signal.aborted) markAborted(db, taskId)
          else markFailed(db, taskId, err?.message || 'learn pipeline failed')
        }
        if (!res.destroyed) {
          sendSSE('error', JSON.stringify({ message: err?.message || 'learn pipeline failed' }))
        }
        finish(1)
      }
      return
    }

    // piSessions 按 `${mode}:${piSessionId}` 隔离：chat 各自独立 session。
    // 前端回传的 sessionId 不带 mode，先按 'chat' 精确查，找不到再按后缀兜底。
    const sessionKey = (m: PiSessionMode, id: string) => `${m}:${id}`
    let existing: AgentSession | undefined
    if (sessionId) {
      existing = piSessions.get(sessionKey('chat', sessionId))
      if (!existing) {
        // 兜底：mode 不一致或旧数据，按 `:${sessionId}` 后缀反查
        for (const [key, s] of piSessions) {
          if (key.endsWith(`:${sessionId}`)) { existing = s; break }
        }
      }
    }
    const isNewSession = !existing
    let session: AgentSession
    if (isNewSession) {
      try {
        session = await createPiSession({ port, mode: 'chat' })
      } catch (err: any) {
        request.log.error({ err }, 'Failed to create pi session')
        return reply.code(500).send({
          success: false,
          error: err?.message || 'Failed to initialize pi runtime'
        })
      }
      piSessions.set(sessionKey('chat', session.sessionId), session)
    } else {
      // isNewSession 为 false 时 existing 必非 undefined（TS 窄化在循环赋值后丢失，这里显式断言）
      session = existing as AgentSession
    }
    const resolvedSessionId = session.sessionId

    // 前端透传 thinkingLevel（默认 off）；若 session 支持则设置
    const level = request.body.thinkingLevel ?? 'off'
    if (typeof (session as any).supportsThinking === 'function' && (session as any).supportsThinking()) {
      session.setThinkingLevel(level as any)
    }

    if (stream) {
      // Streaming mode: SSE（与前端 chat.ts 解析契约严格对齐）
      reply.hijack()
      const res = reply.raw
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        // pi 真实 sessionId 通过 response header 下发；新建/复用都带，前端后续回传
        'x-claude-code-session-id': resolvedSessionId
      })

      const sendSSE = (event: string, data: string) => {
        if (res.destroyed) return
        res.write(encodeSSEFrame({ event, data }))
      }

      let finished = false
      const finish = (code: number) => {
        if (finished) return
        finished = true
        clearTimeout(timeoutId)
        if (!res.destroyed) {
          sendSSE('done', JSON.stringify({ code }))
          res.end()
        }
      }

      // pi 原始事件 → SSE data 帧：映射（含 1-based 轮次计数）由 pi-events 统一处理。
      // agent_end 是终态而非会话领域事件，emitter 不管，留在 route 层收尾。
      // pi session 会被多个 SSE 连接复用（多次追问），轮次计数挂在 session 上跨连接累计，
      // 否则新连接 roundIndex 从 1 重来，前端按 roundIndex 去重会吞掉 round_start 串轮。
      const sessionBox = session as any
      const eventWriter = createPiEventEmitter(
        (ev) => sendSSE('data', JSON.stringify(ev)),
        {
          initialIndex: sessionBox.__learnRoundIndex ?? 0,
          onIndexChange: (n) => { sessionBox.__learnRoundIndex = n },
        },
      )

      const unsub = session.subscribe((raw) => {
        try {
          eventWriter.write(raw)
          if ((raw as any).type === 'agent_end') {
            finish(0)
          }
        } catch (e) {
          request.log.error({ err: e }, 'pi event mapping failed')
        }
      })

      const TIMEOUT = 5 * 60 * 1000
      const timeoutId = setTimeout(() => {
        if (!res.destroyed) {
          sendSSE('error', JSON.stringify({ message: 'Execution timeout (5 minutes)' }))
        }
        session.abort().catch(() => {})
        finish(1)
      }, TIMEOUT)

      res.on('close', () => {
        clearTimeout(timeoutId)
        unsub()
        session.abort().catch(() => {})
      })

      try {
        await session.prompt(prompt)
      } catch (err: any) {
        unsub()
        if (!res.destroyed) {
          sendSSE('error', JSON.stringify({ message: err?.message || 'Prompt failed' }))
        }
        finish(1)
        return
      }

      // prompt 已返回；agent_end 会触发 finish。若未触发（异常路径），waitForIdle 兜底
      session.waitForIdle().catch(() => {})
    } else {
      // Non-streaming mode: buffer 文本后返回 ExecResponse
      let stdout = ''
      let stderr = ''

      const unsub = session.subscribe((ev) => {
        if (ev.type === 'message_update') {
          const ae = (ev as any).assistantMessageEvent
          if (ae?.type === 'text_delta' && typeof ae.delta === 'string') {
            stdout += ae.delta
          }
        } else if (
          ev.type === 'tool_execution_start' ||
          ev.type === 'tool_execution_update' ||
          ev.type === 'tool_execution_end'
        ) {
          const toolName = (ev as any).toolName
          if (toolName) stderr += `[tool:${toolName}]\n`
        }
      })

      try {
        await Promise.race([
          session.prompt(prompt),
          new Promise((_, rej) => setTimeout(() => rej(new Error('Execution timeout (5 minutes)')), 5 * 60 * 1000)),
        ])
        await session.waitForIdle()
        unsub()
        return {
          success: true,
          output: stdout + stderr,
          sessionId: resolvedSessionId,
        }
      } catch (err: any) {
        unsub()
        await session.abort().catch(() => {})
        return reply.code(500).send({
          success: false,
          error: err?.message || 'Prompt failed',
          output: stdout + stderr,
          sessionId: resolvedSessionId,
        })
      }
    }
  })

  // Handle /ui root path (redirect or serve index.html)
  fastify.get('/ui', async (request, reply) => {
    const stream = fs.createReadStream(path.join(uiDistPath, 'index.html'))
    return reply.type('text/html').send(stream)
  })

  // Handle /docs root path
  fastify.get('/docs', async (request, reply) => {
    const stream = fs.createReadStream(path.join(docsDistPath, 'index.html'))
    return reply.type('text/html').send(stream)
  })

  // WebSocket log stream handler (using native ws, not @fastify/websocket)
  function handleLogStream(ws: WebSocket, config: any) {
    const logFile = config.logging.file
    const logPath = path.resolve(logFile)

    // Check if log file exists
    try {
      fs.accessSync(logPath, fs.constants.R_OK)
    } catch {
      ws.send(JSON.stringify({ type: 'warn', msg: `Log file not found: ${logFile}` }))
      ws.close()
      return
    }

    // Filter logs: only send relevant entries to WebSocket clients
    const shouldFilterLog = (logLine: string): boolean => {
      try {
        const log = JSON.parse(logLine)

        // Keep lightweight summaries (request_started, request_completed)
        if (log.type === 'request_started' || log.type === 'request_completed') {
          return true
        }

        // Get URL from various log formats
        const url = log.req?.url || log.path || log.url || ''

        // Only keep logs related to /v1/* proxy requests
        if (url.startsWith('/v1/')) return true

        // Keep logs with proxy-specific fields (requestBody, responseBody from proxy hooks)
        if (log.requestBody || log.responseBody || log.responseType === 'stream/completed') {
          return true
        }

        // Also keep proxy-related messages
        if (log.msg && (
          log.msg.includes('request body captured') ||
          log.msg.includes('fetching from remote server') ||
          log.msg.includes('response received') ||
          log.msg.includes('response stream completed')
        )) {
          return true
        }

        // Filter out everything else (UI requests, static files, etc.)
        return false
      } catch {
        // Invalid JSON, filter out
        return false
      }
    }

    // Track read position for incremental reads (avoid loading entire file on each change)
    let readPosition = 0
    let lastInode = 0
    let lastSize = 0

    // Get initial file metadata
    try {
      const stat = fs.statSync(logPath)
      lastInode = stat.ino
      lastSize = stat.size
    } catch { /* ignore */ }

    // Send initial last 50 lines on connect (one-time full read, acceptable)
    fs.promises.readFile(logPath, 'utf-8').then((content) => {
      const lines = content.trim().split('\n').slice(-50).filter(shouldFilterLog)
      for (const line of lines) {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(line)
        }
      }
      readPosition = content.length
    }).catch(() => {
      // Log file not readable yet
    })

    // Watch for changes — use incremental read instead of full file read
    const watcher = fs.watch(logPath, (event) => {
      if (event === 'change') {
        // Check file metadata to detect rotation (inode/size changed = new file)
        try {
          const stat = fs.statSync(logPath)
          if (stat.ino !== lastInode || stat.size < readPosition) {
            // File rotated — reset position and send last 50 lines of new file
            lastInode = stat.ino
            lastSize = stat.size
            readPosition = 0
            fs.promises.readFile(logPath, 'utf-8').then((content) => {
              const lines = content.trim().split('\n').slice(-50).filter(shouldFilterLog)
              for (const line of lines) {
                if (ws.readyState === WebSocket.OPEN) {
                  ws.send(line)
                }
              }
              readPosition = content.length
            }).catch(() => {})
            return
          }
          lastSize = stat.size
        } catch { return }

        // Incremental read: only read newly appended content
        if (lastSize <= readPosition) return
        const readLen = lastSize - readPosition
        const buffer = Buffer.alloc(readLen)
        try {
          const fd = fs.openSync(logPath, 'r')
          fs.readSync(fd, buffer, 0, readLen, readPosition)
          fs.closeSync(fd)
        } catch { return }

        readPosition = lastSize
        const newContent = buffer.toString('utf-8')
        const lines = newContent.trim().split('\n').filter(l => l.length > 0).filter(shouldFilterLog)
        for (const line of lines) {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(line)
          }
        }
      }
    })

    ws.on('close', () => {
      watcher.close()
    })
  }

  // Global status push timer — single timer broadcasts to all data clients (not per-client)
  let globalStatusTimer: ReturnType<typeof setInterval> | null = null
  function startGlobalStatusTimer(): void {
    if (globalStatusTimer) return
    globalStatusTimer = setInterval(async () => {
      const status = await getProcessStatus('cc-monitoring')
      if (status) {
        statusHistory.push({
          timestamp: Date.now(),
          cpu: status.cpu,
          memory: status.memory
        })
      }
      broadcastToDataClients({
        type: 'status',
        action: 'snapshot',
        data: {
          status: status?.status ?? 'stopped',
          cpu: status?.cpu ?? 0,
          memory: status?.memory ?? 0,
          uptime: status?.uptime ?? 0,
          restarts: status?.restarts ?? 0,
          history: statusHistory.getHistory(3600000)
        }
      })
    }, 10000)
  }

  function stopGlobalStatusTimer(): void {
    if (globalStatusTimer) {
      clearInterval(globalStatusTimer)
      globalStatusTimer = null
    }
  }

  function checkAndStopTimer(): void {
    if (getDataClientCount() === 0) {
      stopGlobalStatusTimer()
    }
  }

  // WebSocket data stream handler
  function handleDataStream(ws: WebSocket) {
    // Add to connection pool
    addDataClient(ws)

    // Start global status timer on first client connection
    startGlobalStatusTimer()

    // Heartbeat timeout tracking: last time we sent a ping and got activity
    let lastPing = Date.now()
    const HEARTBEAT_TIMEOUT = 30000 // 30s: no activity → close

    // Heartbeat timer (10s ping)
    const heartbeatTimer = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'ping', timestamp: Date.now() }))
        lastPing = Date.now()
      }
    }, 10000)

    // Timeout check timer (5s interval)
    const timeoutTimer = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN && Date.now() - lastPing > HEARTBEAT_TIMEOUT) {
        console.warn('WebSocket data client heartbeat timeout, closing')
        ws.close()
      }
    }, 5000)

    // Track pong/any message from client as alive signal
    ws.on('message', () => {
      lastPing = Date.now()
    })

    // Cleanup on close (no statusTimer — handled by global timer)
    ws.on('close', () => {
      clearInterval(heartbeatTimer)
      clearInterval(timeoutTimer)
      removeDataClient(ws)
      checkAndStopTimer()
    })

    ws.on('error', (error) => {
      console.error('WebSocket data client error:', error)
      clearInterval(heartbeatTimer)
      clearInterval(timeoutTimer)
      removeDataClient(ws)
      checkAndStopTimer()
    })
  }

  // Derive server directory from utils dirname (esm-dirname lives in src/utils/)
  const serverDirname = getCallerDirname('../server')
  // 发布产物：dist/ui（bundle-ui.mjs 注入）；本地开发：monorepo 的 proxy-cli/dist
  const bundledUi = path.join(serverDirname, '../ui')
  const uiDistPath = fs.existsSync(bundledUi)
    ? bundledUi
    : path.join(serverDirname, '../../../proxy-cli/dist')
  await fastify.register(staticPlugin, {
    root: uiDistPath,
    prefix: '/ui/',
    decorateReply: false,
    wildcard: true, // Enable wildcard to serve assets properly
    maxAge: 0 // Disable browser caching for dev/prox parity
  })

  // 发布产物：dist/docs（bundle-docs.mjs 注入）；本地开发：monorepo 的 proxy-docs dist
  const bundledDocs = path.join(serverDirname, '../docs')
  const docsDistPath = fs.existsSync(bundledDocs)
    ? bundledDocs
    : path.join(serverDirname, '../../../proxy-docs/dist')
  await fastify.register(staticPlugin, {
    root: docsDistPath,
    prefix: '/docs/',
    decorateReply: false,
    wildcard: true,
    maxAge: 0
  })

  // Note: SPA routing handled by wildcard: true in static plugin
}

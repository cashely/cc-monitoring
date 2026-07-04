import { FastifyInstance } from 'fastify'
import staticPlugin from '@fastify/static'
import path from 'path'
import fs from 'fs'
import { WebSocketServer, WebSocket } from 'ws'
import { loadConfig, saveConfig } from '../config/index.js'
import { getProcessStatus, startProcess, stopProcess, reloadProcess } from '../utils/pm2.js'
import { getCallerDirname } from '../utils/esm-dirname.js'
import { loadRequestDB, listRequestDB, type RequestSummary } from '../utils/request-writer.js'
import { statusHistory } from '../utils/status-history.js'
import { addDataClient, removeDataClient, pushStatsNotify } from './data-push.js'
import { getVersionInfo } from '../utils/version.js'
import { getStatsData, getTodayStats } from '../utils/stats-aggregator.js'
import { setupProvidersRoutes } from './providers-route.js'
import { checkAuth } from './auth.js'

export async function setupUiRoutes(fastify: FastifyInstance): Promise<void> {
  const config = await loadConfig()

  // Mount providers API routes
  await setupProvidersRoutes(fastify, config)

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
    return { config: cfg, versions }
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

  // REST endpoint for listing all saved requests (summary)
  fastify.get('/ui/api/requests', async (request, reply) => {
    try {
      const summaries = await listRequestDB()
      return { requests: summaries }
    } catch (err: any) {
      request.log.error({ err }, 'Failed to list request files')
      return reply.code(500).send({
        error: 'Failed to list requests',
        details: err.message
      })
    }
  })

  // REST endpoint for token aggregation stats (SQLite)
  fastify.get('/ui/api/stats', async (request, reply) => {
    try {
      return getStatsData()
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
        await reloadProcess('cc-monitoring')
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

  // Handle /ui root path (redirect or serve index.html)
  fastify.get('/ui', async (request, reply) => {
    const stream = fs.createReadStream(path.join(uiDistPath, 'index.html'))
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

    // Track read position to only send new lines on change events
    let readPosition = 0

    // Send initial last 50 lines on connect (filtered, async read)
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

    // Watch for changes
    const watcher = fs.watch(logPath, (event) => {
      if (event === 'change') {
        fs.promises.readFile(logPath, 'utf-8').then((content) => {
          if (content.length <= readPosition) return
          const newContent = content.slice(readPosition)
          readPosition = content.length
          const lines = newContent.trim().split('\n').filter(l => l.length > 0).filter(shouldFilterLog)
          for (const line of lines) {
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(line)
            }
          }
        }).catch(() => {
          // File temporarily unavailable
        })
      }
    })

    ws.on('close', () => {
      watcher.close()
    })
  }

  // WebSocket data stream handler
  function handleDataStream(ws: WebSocket) {
    // Add to connection pool
    addDataClient(ws)

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

    // Status push timer (10s)
    const statusTimer = setInterval(async () => {
      if (ws.readyState === WebSocket.OPEN) {
        const status = await getProcessStatus('cc-monitoring')

        // Sample status history (for trend charts) — WebSocket is the primary source
        if (status) {
          statusHistory.push({
            timestamp: Date.now(),
            cpu: status.cpu,
            memory: status.memory
          })
        }

        // Push status snapshot + history
        ws.send(JSON.stringify({
          type: 'status',
          action: 'snapshot',
          data: {
            status: status?.status ?? 'stopped',
            cpu: status?.cpu ?? 0,
            memory: status?.memory ?? 0,
            uptime: status?.uptime ?? 0,
            restarts: status?.restarts ?? 0,
            history: statusHistory.getHistory(3600000) // Last 1 hour
          }
        }))
      }
    }, 10000)

    // Cleanup on close
    ws.on('close', () => {
      clearInterval(heartbeatTimer)
      clearInterval(timeoutTimer)
      clearInterval(statusTimer)
      removeDataClient(ws)
    })

    ws.on('error', (error) => {
      console.error('WebSocket data client error:', error)
      clearInterval(heartbeatTimer)
      clearInterval(timeoutTimer)
      clearInterval(statusTimer)
      removeDataClient(ws)
    })
  }

  // Derive server directory from utils dirname (esm-dirname lives in src/utils/)
  const serverDirname = getCallerDirname('../server')
  const uiDistPath = path.join(serverDirname, '../../../proxy-cli/dist')
  await fastify.register(staticPlugin, {
    root: uiDistPath,
    prefix: '/ui/',
    decorateReply: false,
    wildcard: true, // Enable wildcard to serve assets properly
    maxAge: 0 // Disable browser caching for dev/prox parity
  })

  // Note: SPA routing handled by wildcard: true in static plugin
}

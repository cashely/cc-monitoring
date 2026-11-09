import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { Readable, finished } from 'stream'
import { convertClaudeToOpenAIRequest, convertOpenAIToClaudeResponse, createStreamTransformer, buildOpenAIHeaders } from '../utils/openai-converter.js'
import { ProxyConfig } from '../types/config.js'
import { loadConfig } from '../config/index.js'
import { createRequestRecorder, type RequestRecorder, type RecordedRequest } from '../utils/request-writer.js'
import { cleanOldRequestsDB, interruptStaleRequestsOnStartup } from '../utils/request-writer.js'
import { pushNewRequest, broadcastToDataClients } from './data-push.js'
import { initDatabase, closeDatabase, getDatabase } from '../utils/db.js'
import { recoverCrashedTasks } from '../utils/learn-tasks-db.js'
import { getActiveProvider } from '../utils/providers-db.js'
import { aggregateStats } from '../utils/stats-aggregator.js'
import { mcpManager } from '../utils/mcp-manager.js'
import { getMachineId, getMachineIdSync, preloadMachineId } from '../utils/machine-id.js'
import { createEventDecoder } from '../utils/sse-protocol.js'
import { createClientAbortSignal, createTimeoutSignal } from '../utils/abort-signals.js'

interface ProxyError extends Error {
  code?: string
}

// Extend FastifyRequest to allow any body type (proxy forwarding)
interface ProxyRequest extends FastifyRequest {
  body: any
}

interface ResolvedTarget {
  baseUrl: string
  targetPath: string
  apiKey?: string
  model?: string
  haiku_model?: string
  sonnet_model?: string
  opus_model?: string
  is_openai_compatible?: boolean
  auth_style?: 'bearer' | 'x-api-key'
}

/**
 * Resolves the proxy target per request:
 * - If a provider with is_default=1 exists in DB, use its base_url + api_key + tier models (partial replacement)
 * - Otherwise fall back to config.json proxy.target + proxy.apiKey
 *
 * Called per request for hot-swap support (no server restart needed on activation change).
 * better-sqlite3 is synchronous and ~us-level for a single-row SELECT; cached statement avoids repeated allocation.
 */
export function resolveProxyTarget(proxyConfig: ProxyConfig): ResolvedTarget {
  // Default to config values
  let baseUrl: string
  let targetPath: string
  let apiKey: string | undefined = proxyConfig.apiKey
  let model: string | undefined
  let haiku_model: string | undefined
  let sonnet_model: string | undefined
  let opus_model: string | undefined
  let is_openai_compatible: boolean | undefined
  let auth_style: 'bearer' | 'x-api-key' | undefined

  try {
    // Parse config target as base
    const configUrl = new URL(proxyConfig.target)
    baseUrl = configUrl.origin
    targetPath = configUrl.pathname.replace(/\/$/, '')

    const db = getDatabase()
    const active = getActiveProvider(db)

    if (active) {
      // Replace base_url only if provided
      if (active.base_url && active.base_url.trim() !== '') {
        const providerUrl = new URL(active.base_url)
        baseUrl = providerUrl.origin
        targetPath = providerUrl.pathname.replace(/\/$/, '')
      }

      // Replace api_key only if provided
      if (active.api_key && active.api_key.trim() !== '') {
        apiKey = active.api_key
      }

      // Populate tier models for getProxyModel
      if (active.model && active.model.trim() !== '') model = active.model
      if (active.haiku_model && active.haiku_model.trim() !== '') haiku_model = active.haiku_model
      if (active.sonnet_model && active.sonnet_model.trim() !== '') sonnet_model = active.sonnet_model
      if (active.opus_model && active.opus_model.trim() !== '') opus_model = active.opus_model

      // Populate is_openai_compatible
      is_openai_compatible = !!active.is_openai_compatible

      // Populate auth_style (default bearer for null/unknown)
      auth_style = active.auth_style === 'x-api-key' ? 'x-api-key' : 'bearer'
    }
  } catch {
    // DB not initialized yet, read error, or URL parse error - fall back to config
    const configUrl = new URL(proxyConfig.target)
    baseUrl = configUrl.origin
    targetPath = configUrl.pathname.replace(/\/$/, '')
  }

  return { baseUrl, targetPath, apiKey, model, haiku_model, sonnet_model, opus_model, is_openai_compatible, auth_style }
}

/**
 * Selects the proxy model based on the original request model and provider tier config.
 * - claude-haiku* → haiku_model (fallback: model)
 * - claude-sonnet* → sonnet_model (fallback: model)
 * - claude-opus* → opus_model (fallback: model)
 * - No tier match → model
 * - All empty → undefined (no replacement)
 */
export function getProxyModel(
  originalModel: string | undefined,
  tierModels: { haiku_model?: string; sonnet_model?: string; opus_model?: string; model?: string }
): string | undefined {
  if (!originalModel) return tierModels.model || undefined

  if (originalModel.startsWith('claude-haiku')) {
    return tierModels.haiku_model || tierModels.model || undefined
  }
  if (originalModel.startsWith('claude-sonnet')) {
    return tierModels.sonnet_model || tierModels.model || undefined
  }
  if (originalModel.startsWith('claude-opus')) {
    return tierModels.opus_model || tierModels.model || undefined
  }

  return tierModels.model || undefined
}

// Extract safe headers (avoid circular reference)
export function extractSafeHeaders(headers: Record<string, unknown>): Record<string, string> {
  const safeHeaders: Record<string, string> = {}
  for (const [key, value] of Object.entries(headers)) {
    if (typeof value === 'string' || typeof value === 'number') {
      safeHeaders[key] = String(value)
    } else if (Array.isArray(value)) {
      safeHeaders[key] = value.join(', ')
    }
  }
  return safeHeaders
}

// Filter headers for forwarding (remove problematic ones, replace API key if configured)
export function filterForwardHeaders(
  headers: Record<string, string>,
  proxyApiKey?: string,
  authStyle?: 'bearer' | 'x-api-key'
): Record<string, string> {
  const filtered = { ...headers }

  // Remove headers that cause issues
  delete filtered.host
  delete filtered['content-length']
  delete filtered['x-req-key']

  // Inject or replace API key when proxy key is available
  if (proxyApiKey) {
    // If provider specifies an auth style, normalize to it (override inbound style)
    if (authStyle) {
      delete filtered['x-api-key']
      delete filtered['authorization']
      delete filtered['Authorization']
      if (authStyle === 'bearer') {
        filtered['authorization'] = `Bearer ${proxyApiKey}`
      } else {
        filtered['x-api-key'] = proxyApiKey
      }
      return filtered
    }

    const hasApiKey = 'x-api-key' in filtered
    const hasAuth = 'authorization' in filtered || 'Authorization' in filtered

    if (hasApiKey) {
      // Replace existing x-api-key
      filtered['x-api-key'] = proxyApiKey
    } else if (hasAuth) {
      // Replace existing authorization
      const key = 'authorization' in filtered ? 'authorization' : 'Authorization'
      filtered[key] = `Bearer ${proxyApiKey}`
    } else {
      // No auth header in request → inject x-api-key from provider
      filtered['x-api-key'] = proxyApiKey
    }
  }

  return filtered
}

export function getErrorStatusCode(error: ProxyError): number {
  if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') {
    return 502
  }
  if (error.code === 'ETIMEDOUT') {
    return 504
  }
  return 500
}

export function getErrorMessage(error: ProxyError): string {
  if (error.code === 'ECONNREFUSED') {
    return 'Target server unreachable'
  }
  if (error.code === 'ENOTFOUND') {
    return 'Target server not found'
  }
  if (error.code === 'ETIMEDOUT') {
    return 'Request timeout'
  }
  return 'Proxy error'
}

// SSE 流空闲看门狗：超过该时长无上游数据则销毁流，避免挂死产生僵尸行
const STREAM_IDLE_TIMEOUT_MS = 120000

/**
 * 给上游 nodeStream 挂空闲看门狗：data 到达重置定时器；
 * end/close/error 清理定时器；超时且流未销毁时以 idle timeout 销毁。
 */
function attachIdleWatchdog(nodeStream: Readable): void {
  let timer: NodeJS.Timeout | null = null

  const clearTimer = (): void => {
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
  }
  const resetTimer = (): void => {
    clearTimer()
    timer = setTimeout(() => {
      if (!nodeStream.destroyed) {
        nodeStream.destroy(new Error('upstream idle timeout'))
      }
    }, STREAM_IDLE_TIMEOUT_MS)
  }

  nodeStream.on('data', resetTimer)
  nodeStream.on('end', clearTimer)
  nodeStream.on('close', clearTimer)
  nodeStream.on('error', clearTimer)

  resetTimer()
}

export async function setupProxy(
  fastify: FastifyInstance,
  proxyConfig: ProxyConfig
): Promise<void> {
  // Load full config to get storage.maxDays
  const fullConfig = await loadConfig()
  const maxDays = fullConfig.storage?.maxDays ?? 7

  // Initialize SQLite database
  const db = initDatabase()

  // 回收上次进程遗留的无主 running learn 任务（进程崩溃/被 kill）
  const recoveredTasks = recoverCrashedTasks(db)
  if (recoveredTasks > 0) {
    console.log(`Recovered ${recoveredTasks} crashed learn task(s) from previous run`)
  }

  // 回收上次进程遗留的僵尸 SSE 请求行（流中断/挂死未回调）
  const interruptedRequests = interruptStaleRequestsOnStartup()
  if (interruptedRequests > 0) {
    console.log(`Interrupted ${interruptedRequests} stale request(s) from previous run`)
  }

  // Initialize MCP connections (after DB is ready)
  try {
    await mcpManager.init()
  } catch (err) {
    console.error('MCP manager init failed:', err)
  }

  // Preload machine ID
  await preloadMachineId()

  // Start stats aggregation timer (every 5 minutes)
  const statsTimer = setInterval(() => {
    try {
      aggregateStats(maxDays)
      broadcastToDataClients({ type: 'stats', action: 'notify' })
    } catch (err) {
      console.error('Stats aggregation failed:', err)
    }
  }, 300000) // 5 minutes

  // Periodic cleanup timer (every 30 minutes, not per-request)
  const cleanupTimer = setInterval(() => {
    try {
      cleanOldRequestsDB(maxDays)
    } catch (err) {
      console.error('Cleanup failed:', err)
    }
  }, 1800000) // 30 minutes

  // Initial aggregation on startup
  try {
    aggregateStats(maxDays)
    broadcastToDataClients({ type: 'stats', action: 'notify' })
  } catch (err) {
    console.error('Initial stats aggregation failed:', err)
  }

  // Initial cleanup on startup
  try {
    cleanOldRequestsDB(maxDays)
  } catch (err) {
    console.error('Initial cleanup failed:', err)
  }

  // Cleanup database, MCP connections, and timer on server close
  fastify.addHook('onClose', async () => {
    clearInterval(statsTimer)
    clearInterval(cleanupTimer)
    await mcpManager.close()
    closeDatabase()
  })

  // Application-layer forwarding (Controller + Fetch + SSE Pipe)
  // Fastify parses body automatically -> we get full JSON payload

  fastify.all('/v1/*', async (request: ProxyRequest, reply: FastifyReply) => {
    const startTime = Date.now()
    const resolved = resolveProxyTarget(proxyConfig)
    // 下游客户端中止：整个请求作用域建一次，两处上游 fetch 复用
    const clientSignal = createClientAbortSignal(request.raw)
    const sessionId = (request.headers['x-claude-code-session-id'] as string) || 'unknown-session'

    // Replace model based on tier matching (getProxyModel)
    const originalModel = request.body?.model
    let rec: RequestRecorder | undefined
    try {
      const proxyModel = getProxyModel(originalModel, resolved)
      if (proxyModel && request.body && typeof request.body === 'object') {
        request.body.model = proxyModel
      }
      const forwardedModel = request.body?.model
      if (originalModel !== forwardedModel) {
        request.log.info(`model rewrite: ${originalModel} -> ${forwardedModel} (${request.id})`)
      }

      // Prepare headers for forwarding (replace API key if configured)
      const forwardHeaders = filterForwardHeaders(
        extractSafeHeaders(request.headers),
        resolved.apiKey,
        resolved.auth_style
      )

      // Extract proxy fields
      // API key: extract from authorization (Bearer token) or x-api-key header
      const authHeader = request.headers['authorization'] as string | undefined
      const apiKey = authHeader?.startsWith('Bearer ')
        ? authHeader.slice(7)
        : request.headers['x-api-key'] as string | undefined

      // Proxy API key: what was forwarded to the target server
      const forwardedAuthHeader = forwardHeaders['authorization'] as string | undefined
      const proxyApiKey = forwardHeaders['x-api-key'] ||
        (forwardedAuthHeader?.startsWith('Bearer ') ? forwardedAuthHeader.slice(7) : undefined)

      // Log complete request data (Fastify already parsed body)
      const machineId = getMachineIdSync() ?? undefined
      const meta: RecordedRequest = {
        sessionId,
        localRequestId: request.id, // Will be replaced with cloud x-request-id row on completion
        timestamp: new Date().toISOString(),
        apiKey,
        proxyApiKey,
        baseUrl: resolved.baseUrl,
        model: forwardedModel,
        machineId,
        request: {
          method: request.method,
          path: request.url,
          headers: forwardHeaders,
          body: request.body // Full payload: model, messages, tools, MCP params, etc.
        }
      }
      rec = createRequestRecorder(meta)

      request.log.info(`request logged: ${request.id} ${request.method} ${request.url}`)

      // Save initial record + push pending status to frontend
      await rec.pending()

      // --- OpenAI Compatible Mode ---
      if (resolved.is_openai_compatible) {
        const openaiRequest = convertClaudeToOpenAIRequest(request.body, forwardedModel)
        const openaiHeaders = buildOpenAIHeaders(resolved.apiKey || '')

        // Build target URL: /chat/completions for OpenAI format
        const targetUrlStr = `${resolved.baseUrl}${resolved.targetPath}/chat/completions`

        request.log.info(`forwarding (openai mode) to: ${targetUrlStr}`)

        // Forward converted request to OpenAI-compatible API
        const response = await fetch(targetUrlStr, {
          method: request.method,
          headers: openaiHeaders,
          body: JSON.stringify(openaiRequest),
          signal: createTimeoutSignal(300000, clientSignal)
        })

        request.log.info(`response status: ${response.status}`)

        // Extract cloud request ID
        const cloudRequestId = response.headers.get('x-request-id') || request.id

        // Check response type
        const contentType = response.headers.get('content-type') || ''
        const isSSE = contentType.includes('text/event-stream')
        const isJSON = contentType.includes('application/json')

        // Handle non-streaming JSON response
        if (isJSON && !isSSE && response.body) {
          const responseBody = await response.text()
          let claudeResponseBody: string

          try {
            const openaiRes = JSON.parse(responseBody)
            const claudeRes = convertOpenAIToClaudeResponse(openaiRes, forwardedModel || originalModel)
            claudeResponseBody = JSON.stringify(claudeRes)
            rec.appendEvent(claudeRes)
          } catch {
            claudeResponseBody = responseBody
            try {
              rec.appendEvent(JSON.parse(responseBody))
            } catch {
              rec.appendEvent({ raw: responseBody })
            }
          }

          await rec.complete({
            cloudRequestId: cloudRequestId !== request.id ? cloudRequestId : undefined,
            statusCode: response.status,
            headers: Object.fromEntries(response.headers)
          })

          const elapsed = Date.now() - startTime
          request.log.info(`json response (openai): ${cloudRequestId} ${response.status} (${elapsed}ms)`)
          reply.code(response.status).headers({ 'Content-Type': 'application/json' }).send(claudeResponseBody)
          return
        }

        // Handle SSE streaming response
        // 上游响应头已到达：回写真实 status_code（状态仍 pending，保留 spinner）
        rec.headers({ statusCode: response.status, headers: Object.fromEntries(response.headers) })

        reply.hijack()

        const responseHeaders = Object.fromEntries(response.headers)
        // Replace content-type with Claude SSE format
        responseHeaders['content-type'] = 'text/event-stream'
        reply.raw.writeHead(response.status, responseHeaders)

        if (response.body) {
          const nodeStream = Readable.fromWeb(response.body as any)

          // 客户端断开：销毁上游流，finished 回调走中断落库
          clientSignal.addEventListener('abort', () => {
            if (!nodeStream.destroyed) nodeStream.destroy(new Error('client disconnected'))
          })
          attachIdleWatchdog(nodeStream)

          const transformStream = createStreamTransformer(forwardedModel || originalModel)

          // 旁路解码器：只做事件入库，不介入转发管道；[DONE] 走 onDone 留空，天然不入库
          const tapDecoder = createEventDecoder((e) => rec!.appendEvent(e))

          nodeStream.on('data', (chunk: Buffer) => {
            tapDecoder.write(chunk)
          })

          // Use finished() for reliable stream completion detection
          finished(nodeStream, async (err) => {
            tapDecoder.end()
            if (err) {
              request.log.error(`openai stream error: ${err.message}`)
              rec!.interrupt({ statusCode: response.status, error: `stream interrupted: ${err.message}` })
              return
            }

            // Flush remaining batch + complete request
            try {
              await rec!.complete({
                cloudRequestId: cloudRequestId !== request.id ? cloudRequestId : undefined,
                statusCode: response.status,
                headers: Object.fromEntries(response.headers)
              })
              const elapsed = Date.now() - startTime
              request.log.info(`stream completed (openai): ${cloudRequestId} ${response.status} (${elapsed}ms)`)
            } catch (dbErr: any) {
              request.log.error(`openai stream save failed: ${dbErr.message}`)
            }
          })

          // Pipe: OpenAI SSE → Transform → Claude SSE → Client
          nodeStream.pipe(transformStream).pipe(reply.raw)
        }

        return
      }

      // --- Claude Mode (existing direct forwarding) ---
      // Build target URL correctly
      // request.url = '/v1/messages' -> should become '/apps/anthropic/v1/messages'
      const targetUrlStr = `${resolved.baseUrl}${resolved.targetPath}${request.url}`

      request.log.info(`forwarding to: ${targetUrlStr}`)

      // Forward request to Aliyun with filtered headers
      const response = await fetch(targetUrlStr, {
        method: request.method,
        headers: forwardHeaders,
        body: request.method !== 'GET' ? JSON.stringify(request.body) : undefined,
        signal: createTimeoutSignal(300000, clientSignal)
      })

      request.log.info(`response status: ${response.status}`)

      // Extract cloud request ID from response header
      const cloudRequestId = response.headers.get('x-request-id') || request.id

      // Check response type: SSE stream or JSON
      const contentType = response.headers.get('content-type') || ''
      const isSSE = contentType.includes('text/event-stream')
      const isJSON = contentType.includes('application/json')

      // Handle JSON response (error responses, non-streaming)
      if (isJSON && !isSSE && response.body) {
        const responseBody = await response.text()

        // Record JSON body as a single event
        try {
          const jsonBody = JSON.parse(responseBody)
          rec.appendEvent(jsonBody)
        } catch {
          rec.appendEvent({ raw: responseBody })
        }

        await rec.complete({
          cloudRequestId: cloudRequestId !== request.id ? cloudRequestId : undefined,
          statusCode: response.status,
          headers: Object.fromEntries(response.headers)
        })

        const elapsed = Date.now() - startTime
        request.log.info(`json response: ${cloudRequestId} ${response.status} (${elapsed}ms)`)
        reply.code(response.status)
        reply.headers(Object.fromEntries(response.headers))
        reply.send(responseBody)
        return
      }

      // Hijack reply to take full control of SSE stream
      // 上游响应头已到达：回写真实 status_code（状态仍 pending，保留 spinner）
      rec.headers({ statusCode: response.status, headers: Object.fromEntries(response.headers) })
      reply.hijack()

      // Write response headers (preserve original from Aliyun)
      const responseHeaders = Object.fromEntries(response.headers)
      reply.raw.writeHead(response.status, responseHeaders)

      // Stream SSE response: Aliyun (Web Stream) -> Node Stream -> Claude Code
      if (response.body) {
        // Convert Web ReadableStream to Node Readable stream
        const nodeStream = Readable.fromWeb(response.body as any)

        // 客户端断开：销毁上游流，finished 回调走中断落库
        clientSignal.addEventListener('abort', () => {
          if (!nodeStream.destroyed) nodeStream.destroy(new Error('client disconnected'))
        })
        attachIdleWatchdog(nodeStream)

        // 旁路解码器：只做事件入库，不介入转发管道；[DONE] 走 onDone 留空，天然不入库
        const tapDecoder = createEventDecoder((e) => rec!.appendEvent(e))

        nodeStream.on('data', (chunk: Buffer) => {
          tapDecoder.write(chunk)
        })

        // Save request data when stream completes
        finished(nodeStream, async (err) => {
          tapDecoder.end()
          if (err) {
            request.log.error(`claude stream error: ${err.message}`)
            rec!.interrupt({ statusCode: response.status, error: `stream interrupted: ${err.message}` })
            return
          }

          try {
            await rec!.complete({
              cloudRequestId: cloudRequestId !== request.id ? cloudRequestId : undefined,
              statusCode: response.status,
              headers: Object.fromEntries(response.headers)
            })
            const elapsed = Date.now() - startTime
            request.log.info(`stream completed: ${cloudRequestId} ${response.status} (${elapsed}ms)`)
          } catch (dbErr: any) {
            request.log.error(`stream save failed: ${dbErr.message}`)
          }
        })

        // Pipe: Aliyun -> Claude Code
        nodeStream.pipe(reply.raw)
      }

    } catch (err) {
      const error = err as ProxyError
      request.log.error({
        requestId: request.id,
        errorMessage: error.message,
        errorCode: error.code || 'unknown'
      }, 'proxy error')

      const statusCode = getErrorStatusCode(error)
      if (rec) {
        rec.fail({ statusCode, error: getErrorMessage(error) })
      } else {
        // pending() 之前就抛错（header/meta 准备阶段），无 DB 行可更新，仅推送
        pushNewRequest({
          requestId: request.id,
          sessionId,
          compositeId: `${sessionId}:${request.id}`,
          method: request.method,
          path: request.url,
          timestamp: new Date().toISOString(),
          statusCode,
          responseTime: Date.now() - startTime,
          model: originalModel,
          machineId: getMachineIdSync() ?? undefined,
          userAgent: request.headers['user-agent'],
          baseUrl: resolved.baseUrl
        }, 'completed')
      }

      reply.code(statusCode).send({
        error: getErrorMessage(error),
        requestId: request.id
      })
    }
  })
}
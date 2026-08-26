import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { Readable, finished } from 'stream'
import { convertClaudeToOpenAIRequest, convertOpenAIToClaudeResponse, createStreamTransformer, buildOpenAIHeaders } from '../utils/openai-converter.js'
import { ProxyConfig } from '../types/config.js'
import { loadConfig } from '../config/index.js'
import { saveRequestDB, extractTokenUsage, flushEventBatch, deleteResponseEvents, deleteRequestRow, updateRequestTokens, EVENT_BATCH_SIZE, type RequestData } from '../utils/request-writer.js'
import { cleanOldRequestsDB } from '../utils/request-writer.js'
import { pushNewRequest } from './data-push.js'
import { initDatabase, closeDatabase, getDatabase } from '../utils/db.js'
import { aggregateStats } from '../utils/stats-aggregator.js'
import { mcpManager } from '../utils/mcp-manager.js'
import { getMachineId, getMachineIdSync, preloadMachineId } from '../utils/machine-id.js'

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
}

// Cached prepared statement for active provider lookup (avoids per-request allocation)
let activeProviderStmt: import('better-sqlite3').Statement | null = null
let cachedDbInstance: import('better-sqlite3').Database | null = null

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

  try {
    // Parse config target as base
    const configUrl = new URL(proxyConfig.target)
    baseUrl = configUrl.origin
    targetPath = configUrl.pathname.replace(/\/$/, '')

    const db = getDatabase()
    // Invalidate cached stmt if DB instance changed (happens in tests with fresh DB per test)
    if (db !== cachedDbInstance) {
      activeProviderStmt = null
      cachedDbInstance = db
    }
    if (!activeProviderStmt) {
      activeProviderStmt = db.prepare(
        'SELECT base_url, api_key, model, haiku_model, sonnet_model, opus_model, is_openai_compatible FROM providers WHERE is_default = 1 LIMIT 1'
      )
    }
    const active = activeProviderStmt.get() as { base_url: string | null, api_key: string | null, model: string | null, haiku_model: string | null, sonnet_model: string | null, opus_model: string | null, is_openai_compatible: number | null } | undefined

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
    }
  } catch {
    // DB not initialized yet, read error, or URL parse error - fall back to config
    const configUrl = new URL(proxyConfig.target)
    baseUrl = configUrl.origin
    targetPath = configUrl.pathname.replace(/\/$/, '')
  }

  return { baseUrl, targetPath, apiKey, model, haiku_model, sonnet_model, opus_model, is_openai_compatible }
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
  proxyApiKey?: string
): Record<string, string> {
  const filtered = { ...headers }

  // Remove headers that cause issues
  delete filtered.host
  delete filtered['content-length']
  delete filtered['x-req-key']

  // Inject or replace API key when proxy key is available
  if (proxyApiKey) {
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

/**
 * Push a parsed SSE event into batch/tail buffers.
 * Flushes batch to DB when it reaches EVENT_BATCH_SIZE (10).
 * Only memory held: current batch (≤10 events) + tail (≤5 events).
 */
function pushEventToBuffers(
  event: any,
  sessionId: string,
  requestId: string,
  eventBatch: Array<{ index: number; type?: string; data: unknown }>,
  tailBuffer: any[],
  eventIndexRef: { value: number }
): void {
  const entry = { index: eventIndexRef.value, type: event?.type, data: event }
  eventBatch.push(entry)

  // Maintain tail buffer (last 5 events for usage extraction)
  tailBuffer.push(event)
  if (tailBuffer.length > 5) {
    tailBuffer.shift()
  }

  // Flush batch to DB when threshold reached
  if (eventBatch.length >= EVENT_BATCH_SIZE) {
    flushEventBatch(sessionId, requestId, eventBatch, eventIndexRef.value - eventBatch.length + 1)
    eventBatch.length = 0 // Reset batch (memory freed)
  }

  eventIndexRef.value++
}

/**
 * Flush remaining batch + update request completion in DB.
 * Extracts token usage from tail buffer (no need for full events array).
 */
async function completeStreamSave(
  sessionId: string,
  requestId: string,
  requestData: RequestData,
  eventBatch: Array<{ index: number; type?: string; data: unknown }>,
  tailBuffer: any[],
  eventIndexRef: { value: number },
  startTime: number,
  statusCode: number,
  resolved: ResolvedTarget,
  forwardedModel: string | undefined,
  originalModel: string | undefined,
  machineId: string | undefined,
  request: ProxyRequest
): Promise<void> {
  // Flush remaining events in batch
  if (eventBatch.length > 0) {
    flushEventBatch(sessionId, requestId, eventBatch, eventIndexRef.value - eventBatch.length)
    eventBatch.length = 0
  }

  requestData.response!.completedAt = new Date().toISOString()
  requestData.response!.events = []  // Not needed for streaming, clear to avoid serialization

  await saveRequestDB(sessionId, requestId, requestData)

  const usage = extractTokenUsage(tailBuffer)
  updateRequestTokens(requestId, sessionId, usage)

  pushNewRequest({
    requestId,
    sessionId,
    compositeId: `${sessionId}:${requestId}`,
    method: request.method,
    path: request.url,
    timestamp: requestData.timestamp,
    statusCode,
    responseTime: Date.now() - startTime,
    model: forwardedModel || originalModel,
    machineId,
    baseUrl: resolved.baseUrl,
    usage,
    pendingId: requestId !== request.id ? `${sessionId}:${request.id}` : undefined
  }, 'completed')
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

export async function setupProxy(
  fastify: FastifyInstance,
  proxyConfig: ProxyConfig
): Promise<void> {
  // Load full config to get storage.maxDays
  const fullConfig = await loadConfig()
  const maxDays = fullConfig.storage?.maxDays ?? 7

  // Initialize SQLite database
  initDatabase()

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
      aggregateStats()
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
    aggregateStats()
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
    const sessionId = (request.headers['x-claude-code-session-id'] as string) || 'unknown-session'

    // Replace model based on tier matching (getProxyModel)
    const originalModel = request.body?.model
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
        resolved.apiKey
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
      const requestData: RequestData = {
        requestId: request.id, // Will be updated with cloud x-request-id later
        sessionId,
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
        },
        response: {
          statusCode: 0, // Will be updated after fetch
          events: [] // Only used for JSON responses; streaming uses batch buffer
        }
      }

      // SSE event batch buffer: flush to DB every ~10 events to avoid in-memory accumulation
      // Tail buffer: keep last 5 events for token usage extraction at stream end
      const eventBatch: Array<{ index: number; type?: string; data: unknown }> = []
      const tailBuffer: any[] = []
      const eventIndexRef = { value: 0 }

      request.log.info(`request logged: ${request.id} ${request.method} ${request.url}`)

      // Save initial record + push pending status to frontend
      await saveRequestDB(sessionId, request.id, requestData)
      pushNewRequest({
        requestId: request.id,
        sessionId,
        compositeId: `${sessionId}:${request.id}`,
        method: request.method,
        path: request.url,
        timestamp: requestData.timestamp,
        statusCode: 0,
        responseTime: 0,
        model: forwardedModel,
        machineId,
        baseUrl: resolved.baseUrl
      }, 'pending')

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
          signal: AbortSignal.timeout(300000)
        })

        request.log.info(`response status: ${response.status}`)

        // Extract cloud request ID
        const cloudRequestId = response.headers.get('x-request-id') || request.id
        requestData.requestId = cloudRequestId

        requestData.response!.statusCode = response.status
        requestData.response!.headers = Object.fromEntries(response.headers)

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
            requestData.response!.events!.push(claudeRes)
          } catch {
            claudeResponseBody = responseBody
            try {
              requestData.response!.events!.push(JSON.parse(responseBody))
            } catch {
              requestData.response!.events!.push({ raw: responseBody })
            }
          }

          requestData.response!.completedAt = new Date().toISOString()

          if (cloudRequestId !== request.id) {
            deleteResponseEvents(request.id, sessionId)
            deleteRequestRow(request.id, sessionId)
          }

          await saveRequestDB(sessionId, cloudRequestId, requestData)

          const usage = extractTokenUsage(requestData.response!.events)
          pushNewRequest({
            requestId: cloudRequestId,
            sessionId,
            compositeId: `${sessionId}:${cloudRequestId}`,
            method: request.method,
            path: request.url,
            timestamp: requestData.timestamp,
            statusCode: response.status,
            responseTime: Date.now() - startTime,
            model: forwardedModel,
            machineId,
            baseUrl: resolved.baseUrl,
            usage,
            pendingId: cloudRequestId !== request.id ? `${sessionId}:${request.id}` : undefined
          }, 'completed')

          const elapsed = Date.now() - startTime
          request.log.info(`json response (openai): ${cloudRequestId} ${response.status} (${elapsed}ms)`)
          reply.code(response.status).headers({ 'Content-Type': 'application/json' }).send(claudeResponseBody)
          return
        }

        // Handle SSE streaming response
        reply.hijack()

        const responseHeaders = Object.fromEntries(response.headers)
        // Replace content-type with Claude SSE format
        responseHeaders['content-type'] = 'text/event-stream'
        reply.raw.writeHead(response.status, responseHeaders)

        if (response.body) {
          const nodeStream = Readable.fromWeb(response.body as any)
          const transformStream = createStreamTransformer(forwardedModel || originalModel)

          // Record SSE events via batch buffer (memory: ≤10 batch + ≤5 tail)
          nodeStream.on('data', (chunk: Buffer) => {
            const text = chunk.toString()
            const lines = text.split('\n')
            for (const line of lines) {
              if (line.startsWith('data:')) {
                const eventData = line.slice(5).trim()
                if (eventData && eventData !== '[DONE]') {
                  try {
                    const event = JSON.parse(eventData)
                    pushEventToBuffers(event, sessionId, cloudRequestId, eventBatch, tailBuffer, eventIndexRef)
                  } catch {
                    // Not valid JSON, skip
                  }
                }
              }
            }
          })

          // Use finished() for reliable stream completion detection
          finished(nodeStream, async (err) => {
            if (err) {
              request.log.error(`openai stream error: ${err.message}`)
            }

            // Convert OpenAI stream usage to Claude format for extractTokenUsage compatibility
            const lastChunk = tailBuffer.find((e: any) => e?.usage)
            if (lastChunk?.usage) {
              const syntheticEvent = {
                type: 'message_delta',
                usage: {
                  output_tokens: lastChunk.usage.completion_tokens || 0
                }
              }
              pushEventToBuffers(syntheticEvent, sessionId, cloudRequestId, eventBatch, tailBuffer, eventIndexRef)
            }

            if (cloudRequestId !== request.id) {
              deleteResponseEvents(request.id, sessionId)
              deleteRequestRow(request.id, sessionId)
            }

            // Flush remaining batch + complete request
            try {
              await completeStreamSave(
                sessionId, cloudRequestId, requestData, eventBatch, tailBuffer, eventIndexRef,
                startTime, response.status, resolved, forwardedModel, originalModel, machineId, request
              )
              const elapsed = Date.now() - startTime
              request.log.info(`stream completed (openai): ${cloudRequestId} ${response.status} (${elapsed}ms, ${eventIndexRef.value} events)`)
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
        signal: AbortSignal.timeout(300000)
      })

      request.log.info(`response status: ${response.status}`)

      // Extract cloud request ID from response header
      const cloudRequestId = response.headers.get('x-request-id') || request.id
      requestData.requestId = cloudRequestId

      // Update response status in requestData
      requestData.response!.statusCode = response.status
      requestData.response!.headers = Object.fromEntries(response.headers)

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
          requestData.response!.events!.push(jsonBody)
        } catch {
          requestData.response!.events!.push({ raw: responseBody })
        }

        requestData.response!.completedAt = new Date().toISOString()

        // Remove pending row if cloudRequestId differs from request.id
        if (cloudRequestId !== request.id) {
          deleteResponseEvents(request.id, sessionId)
          deleteRequestRow(request.id, sessionId)
        }

        await saveRequestDB(sessionId, cloudRequestId, requestData)

        const usage = extractTokenUsage(requestData.response!.events)
        pushNewRequest({
          requestId: cloudRequestId,
          sessionId,
          compositeId: `${sessionId}:${cloudRequestId}`,
          method: request.method,
          path: request.url,
          timestamp: requestData.timestamp,
          statusCode: response.status,
          responseTime: Date.now() - startTime,
          model: forwardedModel,
          machineId,
          baseUrl: resolved.baseUrl,
          usage,
          pendingId: cloudRequestId !== request.id ? `${sessionId}:${request.id}` : undefined
        }, 'completed')

        const elapsed = Date.now() - startTime
        request.log.info(`json response: ${cloudRequestId} ${response.status} (${elapsed}ms)`)
        reply.code(response.status)
        reply.headers(Object.fromEntries(response.headers))
        reply.send(responseBody)
        return
      }

      // Hijack reply to take full control of SSE stream
      reply.hijack()

      // Write response headers (preserve original from Aliyun)
      const responseHeaders = Object.fromEntries(response.headers)
      reply.raw.writeHead(response.status, responseHeaders)

      // Stream SSE response: Aliyun (Web Stream) -> Node Stream -> Claude Code
      if (response.body) {
        // Convert Web ReadableStream to Node Readable stream
        const nodeStream = Readable.fromWeb(response.body as any)

        // Record SSE events via batch buffer (memory: ≤10 batch + ≤5 tail)
        nodeStream.on('data', (chunk: Buffer) => {
          const text = chunk.toString()

          const lines = text.split('\n')
          for (const line of lines) {
            if (line.startsWith('data:')) {
              const eventData = line.slice(5).trim()
              if (eventData && eventData !== '[DONE]') {
                try {
                  const event = JSON.parse(eventData)
                  pushEventToBuffers(event, sessionId, cloudRequestId, eventBatch, tailBuffer, eventIndexRef)
                } catch {
                  // Not valid JSON, skip
                }
              }
            }
          }
        })

        // Save request data when stream completes
        finished(nodeStream, async (err) => {
          if (err) {
            request.log.error(`claude stream error: ${err.message}`)
          }

          if (cloudRequestId !== request.id) {
            deleteResponseEvents(request.id, sessionId)
            deleteRequestRow(request.id, sessionId)
          }

          try {
            await completeStreamSave(
              sessionId, cloudRequestId, requestData, eventBatch, tailBuffer, eventIndexRef,
              startTime, response.status, resolved, forwardedModel, originalModel, machineId, request
            )
            const elapsed = Date.now() - startTime
            request.log.info(`stream completed: ${cloudRequestId} ${response.status} (${elapsed}ms, ${eventIndexRef.value} events)`)
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

      // Fetch failed — no cloudRequestId available, use Fastify request.id
      pushNewRequest({
        requestId: request.id,
        sessionId,
        compositeId: `${sessionId}:${request.id}`,
        method: request.method,
        path: request.url,
        timestamp: new Date().toISOString(),
        statusCode: getErrorStatusCode(error),
        responseTime: Date.now() - startTime,
        model: originalModel,
        machineId: getMachineIdSync() ?? undefined,
        baseUrl: resolved.baseUrl
      }, 'completed')

      const statusCode = getErrorStatusCode(error)
      reply.code(statusCode).send({
        error: getErrorMessage(error),
        requestId: request.id
      })
    }
  })
}
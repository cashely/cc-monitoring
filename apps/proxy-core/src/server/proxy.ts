import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { Readable } from 'stream'
import { ProxyConfig } from '../types/config.js'
import { loadConfig } from '../config/index.js'
import { saveRequestDB, extractTokenUsage, type RequestData } from '../utils/request-writer.js'
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
}

/**
 * Resolves the proxy target per request:
 * - If a provider with is_default=1 exists in DB, use its base_url + api_key + tier models (partial replacement)
 * - Otherwise fall back to config.json proxy.target + proxy.apiKey
 *
 * Called per request for hot-swap support (no server restart needed on activation change).
 * better-sqlite3 is synchronous and ~us-level for a single-row SELECT; no caching needed.
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

  try {
    // Parse config target as base
    const configUrl = new URL(proxyConfig.target)
    baseUrl = configUrl.origin
    targetPath = configUrl.pathname.replace(/\/$/, '')

    const db = getDatabase()
    const active = db.prepare(
      'SELECT base_url, api_key, model, haiku_model, sonnet_model, opus_model FROM providers WHERE is_default = 1 LIMIT 1'
    ).get() as { base_url: string | null, api_key: string | null, model: string | null, haiku_model: string | null, sonnet_model: string | null, opus_model: string | null } | undefined

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
    }
  } catch {
    // DB not initialized yet, read error, or URL parse error - fall back to config
    const configUrl = new URL(proxyConfig.target)
    baseUrl = configUrl.origin
    targetPath = configUrl.pathname.replace(/\/$/, '')
  }

  return { baseUrl, targetPath, apiKey, model, haiku_model, sonnet_model, opus_model }
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

  // Initial aggregation on startup
  try {
    aggregateStats()
  } catch (err) {
    console.error('Initial stats aggregation failed:', err)
  }

  // Cleanup database, MCP connections, and timer on server close
  fastify.addHook('onClose', async () => {
    clearInterval(statsTimer)
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
          events: [] // SSE events will be recorded here
        }
      }

      await cleanOldRequestsDB(maxDays)

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

      // Build target URL correctly
      // request.url = '/v1/messages' -> should become '/apps/anthropic/v1/messages'
      const targetUrlStr = `${resolved.baseUrl}${resolved.targetPath}${request.url}`

      request.log.info(`forwarding to: ${targetUrlStr}`)

      // Forward request to Aliyun with filtered headers
      const response = await fetch(targetUrlStr, {
        method: request.method,
        headers: forwardHeaders,
        body: request.method !== 'GET' ? JSON.stringify(request.body) : undefined
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
          const db = getDatabase()
          db.prepare('DELETE FROM requests WHERE request_id = ? AND session_id = ?').run(request.id, sessionId)
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

        // Record SSE events while forwarding
        nodeStream.on('data', (chunk: Buffer) => {
          const text = chunk.toString()

          const lines = text.split('\n')
          for (const line of lines) {
            // Handle both standard SSE and Aliyun format
            // Standard: data: {...}
            // Aliyun: event:xxx\ndata:{...}
            if (line.startsWith('data:')) {
              const eventData = line.slice(5).trim() // Remove 'data:' prefix
              if (eventData && eventData !== '[DONE]') {
                try {
                  const event = JSON.parse(eventData)
                  requestData.response!.events!.push(event)
                } catch {
                  // Not valid JSON, skip
                }
              }
            }
          }
        })

        // Save request data when stream completes
        nodeStream.on('end', async () => {
          const elapsed = Date.now() - startTime
          requestData.response!.completedAt = new Date().toISOString()

          // Remove pending row if cloudRequestId differs from request.id
          if (cloudRequestId !== request.id) {
            const db = getDatabase()
            db.prepare('DELETE FROM requests WHERE request_id = ? AND session_id = ?').run(request.id, sessionId)
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
            responseTime: elapsed,
            model: forwardedModel,
            machineId,
            baseUrl: resolved.baseUrl,
            usage,
            pendingId: cloudRequestId !== request.id ? `${sessionId}:${request.id}` : undefined
          }, 'completed')

          request.log.info(`stream completed: ${cloudRequestId} ${response.status} (${elapsed}ms, ${requestData.response!.events!.length} events)`)
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
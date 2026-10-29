import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { Readable } from 'stream'
import { randomUUID } from 'node:crypto'
import { ProxyConfig } from '../types/config.js'
import { loadConfig } from '../config/index.js'
import { saveRequestDB, extractTokenUsage, type RequestData, loadSessionHistory } from '../utils/request-writer.js'
import { cleanOldRequestsDB } from '../utils/request-writer.js'
import { pushNewRequest } from './data-push.js'
import { initDatabase, getDatabase } from '../utils/db.js'
import { resolveProxyTarget, getProxyModel, filterForwardHeaders, extractSafeHeaders } from './proxy.js'
import { injectMcpTools } from '../utils/tool-injector.js'
import { runInjectLoop, parseSSEText, parseUpstreamEvents, findInjectedCall, runJsonInjectLoop, runStreamingInjectLoop } from '../utils/inject-loop.js'
import { findEnabledTool } from '../tools/index.js'
import { writeSSEEvent, writeTextAsSSE, shouldMock } from '../utils/sse-writer.js'
import { SSEStreamProcessor } from '../utils/sse-stream-processor.js'
import { getMachineId, getMachineIdSync, preloadMachineId } from '../utils/machine-id.js'

interface ChatRequest extends FastifyRequest {
  body: any
}

export async function setupChatRoute(
  fastify: FastifyInstance,
  proxyConfig: ProxyConfig
): Promise<void> {
  const fullConfig = await loadConfig()
  const maxDays = fullConfig.storage?.maxDays ?? 7

  initDatabase()
  await preloadMachineId()

  fastify.post('/api/chat', async (request: ChatRequest, reply: FastifyReply) => {
    const startTime = Date.now()
    const resolved = resolveProxyTarget(proxyConfig)

    // Generate or reuse session ID
    const providedSessionId = request.headers['x-chat-session-id'] as string | undefined
    const sessionId = providedSessionId || randomUUID()

    // Validate request body
    if (!request.body?.model || !Array.isArray(request.body?.messages)) {
      return reply.code(400).send({
        error: 'invalid_request',
        message: 'Request body must contain "model" and "messages" fields'
      })
    }

    // Session resume: if sessionId exists in DB, load history and prepend
    if (providedSessionId) {
      const history = loadSessionHistory(providedSessionId)
      if (history) {
        // Prepend history messages before the new user messages
        request.body.messages = [...history.messages, ...request.body.messages]
        // Carry over system prompt if provided and not in current request
        if (history.system && !request.body.system && !request.body.system_prompt) {
          request.body.system = history.system
        }
        request.log.info(`[chat] session resumed: ${providedSessionId}, history: ${history.messages.length} messages`)
      }
    }

    // Rewrite model based on tier
    const originalModel = request.body.model
    const proxyModel = getProxyModel(originalModel, resolved)
    if (proxyModel) {
      request.body.model = proxyModel
    }
    const forwardedModel = request.body.model

    // Inject MCP tools only (not probe/curl)
    const injectedNames = injectMcpTools(request.body)
    const injected = injectedNames.length > 0
    if (injected) {
      request.log.info(`[chat] MCP tools injected: ${injectedNames.join(',')} (${request.id})`)
    }

    // Filter and forward headers
    const forwardHeaders = filterForwardHeaders(
      extractSafeHeaders(request.headers),
      resolved.apiKey
    )
    forwardHeaders['x-chat-session-id'] = sessionId

    // Extract API keys for recording
    const authHeader = request.headers['authorization'] as string | undefined
    const apiKey = authHeader?.startsWith('Bearer ')
      ? authHeader.slice(7)
      : request.headers['x-api-key'] as string | undefined
    const forwardedAuthHeader = forwardHeaders['authorization'] as string | undefined
    const proxyApiKey = forwardHeaders['x-api-key'] ||
      (forwardedAuthHeader?.startsWith('Bearer ') ? forwardedAuthHeader.slice(7) : undefined)

    // Build request data
    const machineId = getMachineIdSync() ?? undefined
    const requestData: RequestData = {
      requestId: request.id,
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
        body: request.body
      },
      response: {
        statusCode: 0,
        events: []
      }
    }

    await cleanOldRequestsDB(maxDays)

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
      userAgent: request.headers['user-agent'],
      baseUrl: resolved.baseUrl
    }, 'pending')

    // Mock interception (PoC)
    if (shouldMock(request.body)) {
      reply.hijack()
      reply.raw.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        'connection': 'keep-alive'
      })
      writeTextAsSSE(
        reply.raw,
        '[PoC] 这是 /api/chat 构造的合成响应，未经过真实大模型。',
        `msg_poc_chat_${request.id}`
      )
      reply.raw.end()
      return
    }

    // Build target URL — always target /v1/messages
    const targetUrlStr = `${resolved.baseUrl}${resolved.targetPath}/v1/messages`

    request.log.info(`[chat] forwarding to: ${targetUrlStr}`)

    // Forward to upstream
    const response = await fetch(targetUrlStr, {
      method: 'POST',
      headers: forwardHeaders,
      body: JSON.stringify(request.body),
      signal: AbortSignal.timeout(300000)
    })

    request.log.info(`[chat] response status: ${response.status}`)

    // Extract cloud request ID
    const cloudRequestId = response.headers.get('x-request-id') || request.id
    requestData.requestId = cloudRequestId
    requestData.response!.statusCode = response.status
    requestData.response!.headers = Object.fromEntries(response.headers)

    // Check response type
    const contentType = response.headers.get('content-type') || ''
    const isSSE = contentType.includes('text/event-stream')
    const isJSON = contentType.includes('application/json')

    // === JSON response (non-streaming) ===
    if (isJSON && !isSSE && response.body) {
      const responseBody = await response.text()
      let jsonBody: any
      try {
        jsonBody = JSON.parse(responseBody)
        requestData.response!.events!.push(jsonBody)
      } catch {
        requestData.response!.events!.push({ raw: responseBody })
      }

      // JSON inject loop: if MCP tools injected and response has tool_use
      if (injected && jsonBody && jsonBody.stop_reason === 'tool_use') {
        const toolCalls = (jsonBody.content || []).filter((b: any) => b.type === 'tool_use')
        const hitCall = toolCalls.find((b: any) => findEnabledTool(b.name))
        if (hitCall) {
          request.log.info(`[chat] json tool hit: ${hitCall.name} (${cloudRequestId})`)

          const loopResult = await runJsonInjectLoop({
            initialBody: jsonBody,
            requestBody: request.body,
            callUpstream: async (b) => {
              const r = await fetch(targetUrlStr, {
                method: 'POST',
                headers: forwardHeaders,
                body: JSON.stringify(b),
                signal: AbortSignal.timeout(300000)
              })
              const loopResponseBody = await r.text()
              let loopJson: any
              try { loopJson = JSON.parse(loopResponseBody) } catch { /* ignore */ }

              // Record each loop iteration as a separate request
              if (loopJson) {
                const loopRequestId = r.headers.get('x-request-id') || `loop_${request.id}_${Date.now()}`
                const loopData: RequestData = {
                  requestId: loopRequestId,
                  sessionId,
                  timestamp: new Date().toISOString(),
                  apiKey,
                  proxyApiKey,
                  baseUrl: resolved.baseUrl,
                  model: forwardedModel,
                  machineId,
                  request: { method: 'POST', path: '/api/chat', headers: forwardHeaders, body: b },
                  response: {
                    statusCode: r.status,
                    headers: Object.fromEntries(r.headers),
                    events: [loopJson],
                    completedAt: new Date().toISOString()
                  }
                }
                await saveRequestDB(sessionId, loopRequestId, loopData)
                const loopUsage = extractTokenUsage(loopData.response!.events)
                pushNewRequest({
                  requestId: loopRequestId,
                  sessionId,
                  compositeId: `${sessionId}:${loopRequestId}`,
                  method: 'POST',
                  path: '/api/chat',
                  timestamp: loopData.timestamp,
                  statusCode: r.status,
                  responseTime: 0,
                  model: forwardedModel,
                  machineId,
                  userAgent: request.headers['user-agent'],
                  baseUrl: resolved.baseUrl,
                  usage: loopUsage
                }, 'completed')
              }
              return loopJson || JSON.parse(loopResponseBody)
            }
          })

          request.log.info(`[chat] json loop done: ${loopResult.iterations} iter (${cloudRequestId})`)

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
            userAgent: request.headers['user-agent'],
            baseUrl: resolved.baseUrl,
            usage,
            pendingId: cloudRequestId !== request.id ? `${sessionId}:${request.id}` : undefined
          }, 'completed')

          const finalBody = { ...loopResult.finalBody, _sessionId: sessionId }
          reply.code(200).header('x-chat-session-id', sessionId).send(JSON.stringify(finalBody))
          return
        }
      }

      // Normal JSON passthrough
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
        userAgent: request.headers['user-agent'],
        baseUrl: resolved.baseUrl,
        usage,
        pendingId: cloudRequestId !== request.id ? `${sessionId}:${request.id}` : undefined
      }, 'completed')

      // Inject session ID into response for passthrough
      try {
        const passthroughBody = JSON.parse(responseBody)
        passthroughBody._sessionId = sessionId
        reply.code(response.status)
        reply.header('x-chat-session-id', sessionId)
        reply.send(JSON.stringify(passthroughBody))
      } catch {
        reply.code(response.status)
        reply.headers(Object.fromEntries(response.headers))
        reply.send(responseBody)
      }
      return
    }

    // === SSE response (streaming — unified path) ===
    if (isSSE && response.body) {
      reply.hijack()
      reply.raw.writeHead(response.status, { ...Object.fromEntries(response.headers), 'x-chat-session-id': sessionId })

      const processor = new SSEStreamProcessor(reply.raw)
      const nodeStream = Readable.fromWeb(response.body as any)

      nodeStream.on('data', (chunk: Buffer) => {
        // SSEStreamProcessor.processChunk 同时转发到 reply.raw + 增量解析
        processor.processChunk(chunk)
      })

      nodeStream.on('end', async () => {
        processor.flushLeftover()

        // 保存原始请求到 DB
        requestData.response!.events = processor.events
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
          userAgent: request.headers['user-agent'],
          baseUrl: resolved.baseUrl,
          usage,
          pendingId: cloudRequestId !== request.id ? `${sessionId}:${request.id}` : undefined
        }, 'completed')

        request.log.info(`[chat] stream completed: ${cloudRequestId} ${response.status} (${Date.now() - startTime}ms, ${processor.events.length} events)`)

        // 检测注入的 MCP tool_use → 发 proxy_status 信号 + 跑 streaming inject loop
        if (processor.hasInjectedToolUse()) {
          const injectedCall = findInjectedCall(processor.getParsedUpstream())
          // 通知客户端：proxy 正在代行 tool，同连接上还有续接数据
          writeSSEEvent(reply.raw, { type: 'proxy_status', status: 'tool_executing', tool: injectedCall?.name })

          request.log.info(`[chat] SSE tool hit, entering streaming inject loop: ${cloudRequestId}`)

          await runStreamingInjectLoop({
            initialParsed: processor.getParsedUpstream(),
            body: request.body,
            callUpstream: async (b) => {
              const r = await fetch(targetUrlStr, {
                method: 'POST',
                headers: forwardHeaders,
                body: JSON.stringify(b),
                signal: AbortSignal.timeout(300000)
              })
              const loopRequestId = r.headers.get('x-request-id') || `loop_${request.id}_${Date.now()}`
              return { response: r, requestId: loopRequestId }
            },
            streamAndParse: async (loopResponse) => {
              // 流式转发 loop 迭代的 SSE 到同一 reply.raw
              const loopProcessor = new SSEStreamProcessor(reply.raw)
              const loopStream = Readable.fromWeb(loopResponse.body as any)

              loopStream.on('data', (chunk: Buffer) => loopProcessor.processChunk(chunk))

              return new Promise<{ processor: SSEStreamProcessor, statusCode: number }>((resolve, reject) => {
                loopStream.on('end', () => {
                  loopProcessor.flushLeftover()
                  resolve({ processor: loopProcessor, statusCode: loopResponse.status })
                })
                loopStream.on('error', (err: Error) => {
                  request.log.error({ err }, `[chat] loop stream error`)
                  reject(err)
                })
              })
            },
            sessionId,
            saveIterationDB: async (loopRequestId, loopProcessor, loopStatusCode, loopBody) => {
              const loopData: RequestData = {
                requestId: loopRequestId,
                sessionId,
                timestamp: new Date().toISOString(),
                apiKey,
                proxyApiKey,
                baseUrl: resolved.baseUrl,
                model: forwardedModel,
                machineId,
                request: { method: 'POST', path: '/api/chat', headers: forwardHeaders, body: loopBody },
                response: {
                  statusCode: loopStatusCode,
                  events: loopProcessor.events,
                  completedAt: new Date().toISOString()
                }
              }
              await saveRequestDB(sessionId, loopRequestId, loopData)
              const loopUsage = extractTokenUsage(loopProcessor.events)
              pushNewRequest({
                requestId: loopRequestId,
                sessionId,
                compositeId: `${sessionId}:${loopRequestId}`,
                method: 'POST',
                path: '/api/chat',
                timestamp: loopData.timestamp,
                statusCode: loopStatusCode,
                responseTime: 0,
                model: forwardedModel,
                machineId,
                userAgent: request.headers['user-agent'],
                baseUrl: resolved.baseUrl,
                usage: loopUsage
              }, 'completed')
            },
            raw: reply.raw
          })

          request.log.info(`[chat] SSE streaming inject loop done: ${cloudRequestId}`)
        }

        reply.raw.end()
      })

      nodeStream.on('error', (err: Error) => {
        request.log.error({ err }, `[chat] stream error: ${cloudRequestId}`)
        reply.raw.end()
      })

      return
    }

    // No body — error
    reply.code(response.status).send('')
  })
}

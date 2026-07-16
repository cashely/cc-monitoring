import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { Readable } from 'stream'
import { randomUUID } from 'node:crypto'
import { ProxyConfig } from '../types/config.js'
import { loadConfig } from '../config/index.js'
import { saveRequestDB, extractTokenUsage, type RequestData, loadSessionHistory } from '../utils/request-writer.js'
import { cleanOldRequestsDB } from '../utils/request-writer.js'
import { pushNewRequest } from './data-push.js'
import { initDatabase } from '../utils/db.js'
import { resolveProxyTarget, getProxyModel, filterForwardHeaders, extractSafeHeaders } from './proxy.js'
import { injectMcpTools } from '../utils/tool-injector.js'
import { runInjectLoop, parseSSEText, parseUpstreamEvents, findInjectedCall, runJsonInjectLoop } from '../utils/inject-loop.js'
import { findEnabledTool } from '../tools/index.js'
import { writeTextAsSSE, shouldMock } from '../utils/sse-writer.js'
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
      body: JSON.stringify(request.body)
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
                body: JSON.stringify(b)
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
                  baseUrl: resolved.baseUrl,
                  usage: loopUsage
                })
              }
              return loopJson || JSON.parse(loopResponseBody)
            }
          })

          request.log.info(`[chat] json loop done: ${loopResult.iterations} iter (${cloudRequestId})`)

          requestData.response!.completedAt = new Date().toISOString()
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
            usage
          })

          // Send final loop result with session ID
          const finalBody = { ...loopResult.finalBody, _sessionId: sessionId }
          reply.code(200).header('x-chat-session-id', sessionId).send(JSON.stringify(finalBody))
          return
        }
      }

      // Normal JSON passthrough
      requestData.response!.completedAt = new Date().toISOString()
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
        usage
      })

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

    // === SSE response (streaming) ===
    if (injected && isSSE && response.body) {
      // Buffer full stream to detect tool_use
      const fullText = await response.text()
      const events = parseSSEText(fullText)
      requestData.response!.events = events

      const parsed = parseUpstreamEvents(events)
      const hitInjected = findInjectedCall(parsed) && parsed.stopReason === 'tool_use'

      reply.hijack()

      if (!hitInjected) {
        // No tool hit — replay buffered SSE as-is with session ID
        const sseHeaders = { ...Object.fromEntries(response.headers), 'x-chat-session-id': sessionId }
        reply.raw.writeHead(response.status, sseHeaders)
        reply.raw.end(fullText)
      } else {
        // Tool hit — run inject loop
        request.log.info(`[chat] SSE tool hit, entering loop: ${cloudRequestId}`)
        const loop = await runInjectLoop({
          events,
          body: request.body,
          callUpstream: async (b) => {
            const r = await fetch(targetUrlStr, {
              method: 'POST',
              headers: forwardHeaders,
              body: JSON.stringify(b)
            })
            const loopSseText = await r.text()
            const loopEvents = parseSSEText(loopSseText)

            // Record each loop iteration as a separate request
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
                events: loopEvents,
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
              baseUrl: resolved.baseUrl,
              usage: loopUsage
            })

            return loopEvents
          }
        })
        reply.raw.writeHead(200, {
          'content-type': 'text/event-stream',
          'cache-control': 'no-cache',
          'connection': 'keep-alive',
          'x-chat-session-id': sessionId
        })
        writeTextAsSSE(reply.raw, loop.text, `msg_chat_${cloudRequestId}`)
        reply.raw.end()
        request.log.info(`[chat] SSE loop done: ${cloudRequestId} (${loop.iterations} iter, limit=${loop.stoppedByLimit})`)
      }

      requestData.response!.completedAt = new Date().toISOString()
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
        usage
      })
      return
    }

    // === SSE passthrough (no injection or no tool hit path not taken) ===
    if (response.body) {
      reply.hijack()
      reply.raw.writeHead(response.status, { ...Object.fromEntries(response.headers), 'x-chat-session-id': sessionId })

      const nodeStream = Readable.fromWeb(response.body as any)
      let sseEvents: any[] = []

      nodeStream.on('data', (chunk: Buffer) => {
        reply.raw.write(chunk)
        // Parse SSE events for recording
        const text = chunk.toString()
        for (const line of text.split('\n')) {
          if (line.startsWith('data:')) {
            const d = line.slice(5).trim()
            if (d && d !== '[DONE]') {
              try { sseEvents.push(JSON.parse(d)) } catch { /* skip */ }
            }
          }
        }
      })

      nodeStream.on('end', async () => {
        requestData.response!.events = sseEvents
        requestData.response!.completedAt = new Date().toISOString()
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
          usage
        })

        request.log.info(`[chat] stream completed: ${cloudRequestId} ${response.status} (${Date.now() - startTime}ms, ${sseEvents.length} events)`)
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

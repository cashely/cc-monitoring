import { getErrorStatusCode, getErrorMessage, resolveProxyTarget, filterForwardHeaders, setupProxy } from '../proxy'
import Fastify from 'fastify'
import type { FastifyInstance } from 'fastify'
import http from 'node:http'
import Database from 'better-sqlite3'
import { WebSocket } from 'ws'
import { addDataClient, removeDataClient } from '../data-push'

jest.mock('@utils/db', () => ({
  __esModule: true,
  getDatabase: jest.fn(),
  initDatabase: jest.fn(),
  closeDatabase: jest.fn()
}))

jest.mock('@config/index', () => ({
  loadConfig: jest.fn().mockResolvedValue({ storage: { maxDays: 7 } })
}))

jest.mock('../../utils/mcp-manager', () => ({
  mcpManager: {
    init: jest.fn().mockResolvedValue(undefined),
    close: jest.fn().mockResolvedValue(undefined)
  }
}))

jest.mock('../../utils/machine-id', () => ({
  getMachineId: jest.fn().mockResolvedValue('test-machine-id'),
  getMachineIdSync: jest.fn().mockReturnValue('test-machine-id'),
  preloadMachineId: jest.fn().mockResolvedValue(undefined)
}))

jest.mock('../../utils/stats-aggregator', () => ({
  aggregateStats: jest.fn()
}))

const { getDatabase, initDatabase } = jest.requireMock('@utils/db') as {
  getDatabase: jest.Mock
  initDatabase: jest.Mock
}

interface ProxyError extends Error {
  code?: string
}

function makeError(code: string, message: string): ProxyError {
  const error = new Error(message) as ProxyError
  error.code = code
  return error
}

describe('getErrorStatusCode', () => {
  it('returns 502 for ECONNREFUSED', () => {
    const error = makeError('ECONNREFUSED', 'connection refused')
    expect(getErrorStatusCode(error)).toBe(502)
  })

  it('returns 502 for ENOTFOUND', () => {
    const error = makeError('ENOTFOUND', 'not found')
    expect(getErrorStatusCode(error)).toBe(502)
  })

  it('returns 504 for ETIMEDOUT', () => {
    const error = makeError('ETIMEDOUT', 'timeout')
    expect(getErrorStatusCode(error)).toBe(504)
  })

  it('returns 500 for unknown error codes', () => {
    const error = makeError('EUNKNOWN', 'something else')
    expect(getErrorStatusCode(error)).toBe(500)
  })

  it('returns 500 for error with no code', () => {
    const error = new Error('generic') as ProxyError
    expect(getErrorStatusCode(error)).toBe(500)
  })
})

describe('getErrorMessage', () => {
  it('returns "Target server unreachable" for ECONNREFUSED', () => {
    const error = makeError('ECONNREFUSED', 'connection refused')
    expect(getErrorMessage(error)).toBe('Target server unreachable')
  })

  it('returns "Target server not found" for ENOTFOUND', () => {
    const error = makeError('ENOTFOUND', 'not found')
    expect(getErrorMessage(error)).toBe('Target server not found')
  })

  it('returns "Request timeout" for ETIMEDOUT', () => {
    const error = makeError('ETIMEDOUT', 'timeout')
    expect(getErrorMessage(error)).toBe('Request timeout')
  })

  it('returns "Proxy error" for unknown error codes', () => {
    const error = makeError('EUNKNOWN', 'something else')
    expect(getErrorMessage(error)).toBe('Proxy error')
  })

  it('returns "Proxy error" for error with no code', () => {
    const error = new Error('generic') as ProxyError
    expect(getErrorMessage(error)).toBe('Proxy error')
  })
})

describe('resolveProxyTarget', () => {
  let db: Database.Database
  const config = {
    target: 'https://config.example.com/apps/anthropic',
    changeOrigin: true,
    apiKey: 'config-key'
  } as any

  beforeEach(() => {
    jest.clearAllMocks()
    db = new Database(':memory:')
    db.exec(`CREATE TABLE providers (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE NOT NULL, base_url TEXT, api_key TEXT, model TEXT, haiku_model TEXT, sonnet_model TEXT, opus_model TEXT, subagent_model TEXT, provider TEXT NOT NULL, is_default INTEGER NOT NULL DEFAULT 0, is_openai_compatible INTEGER NOT NULL DEFAULT 0, auth_style TEXT NOT NULL DEFAULT 'bearer', created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP)`)
    getDatabase.mockReturnValue(db)
  })

  afterEach(() => {
    db.close()
  })

  test('uses active provider base_url and api_key when one is active', () => {
    db.prepare('INSERT INTO providers (name, base_url, api_key, model, provider, is_default) VALUES (?, ?, ?, ?, ?, ?)').run(
      'test-provider', 'https://provider.example.com/v1', 'provider-key', 'test-model', 'anthropic', 1
    )

    const result = resolveProxyTarget(config)
    expect(result.baseUrl).toBe('https://provider.example.com')
    expect(result.targetPath).toBe('/v1')
    expect(result.apiKey).toBe('provider-key')
  })

  test('falls back to config when no active provider', () => {
    const result = resolveProxyTarget(config)
    expect(result.baseUrl).toBe('https://config.example.com')
    expect(result.targetPath).toBe('/apps/anthropic')
    expect(result.apiKey).toBe('config-key')
  })

  test('falls back to config when DB throws', () => {
    getDatabase.mockImplementation(() => { throw new Error('DB not initialized') })

    const result = resolveProxyTarget(config)
    expect(result.baseUrl).toBe('https://config.example.com')
    expect(result.targetPath).toBe('/apps/anthropic')
    expect(result.apiKey).toBe('config-key')
  })

  test('returns is_openai_compatible from active provider', () => {
    db.prepare('INSERT INTO providers (name, base_url, api_key, model, provider, is_default, is_openai_compatible) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
      'openai-provider', 'https://api.openai.com/v1', 'openai-key', 'gpt-4', 'openai', 1, 1
    )

    const result = resolveProxyTarget(config)
    expect(result.is_openai_compatible).toBe(true)
  })

  test('returns is_openai_compatible as false when not set', () => {
    db.prepare('INSERT INTO providers (name, base_url, api_key, model, provider, is_default, is_openai_compatible) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
      'claude-provider', 'https://provider.example.com/v1', 'provider-key', 'test-model', 'anthropic', 1, 0
    )

    const result = resolveProxyTarget(config)
    expect(result.is_openai_compatible).toBe(false)
  })

  test('returns auth_style x-api-key when provider sets it', () => {
    db.prepare('INSERT INTO providers (name, base_url, api_key, model, provider, is_default, auth_style) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
      'xkey-provider', 'https://provider.example.com/v1', 'provider-key', 'test-model', 'anthropic', 1, 'x-api-key'
    )

    const result = resolveProxyTarget(config)
    expect(result.auth_style).toBe('x-api-key')
  })

  test('defaults auth_style to bearer when column is null', () => {
    db.prepare('INSERT INTO providers (name, base_url, api_key, model, provider, is_default) VALUES (?, ?, ?, ?, ?, ?)').run(
      'bearer-provider', 'https://provider.example.com/v1', 'provider-key', 'test-model', 'anthropic', 1
    )

    const result = resolveProxyTarget(config)
    expect(result.auth_style).toBe('bearer')
  })
})

describe('filterForwardHeaders with authStyle', () => {
  test('bearer style: inbound x-api-key is normalized to authorization Bearer', () => {
    const out = filterForwardHeaders({ 'x-api-key': 'inbound-key' }, 'proxy-key', 'bearer')
    expect(out['authorization']).toBe('Bearer proxy-key')
    expect(out['x-api-key']).toBeUndefined()
  })

  test('x-api-key style: inbound authorization Bearer is normalized to x-api-key', () => {
    const out = filterForwardHeaders({ 'authorization': 'Bearer inbound-key' }, 'proxy-key', 'x-api-key')
    expect(out['x-api-key']).toBe('proxy-key')
    expect(out['authorization']).toBeUndefined()
    expect(out['Authorization']).toBeUndefined()
  })

  test('authStyle not provided keeps inbound style (x-api-key stays)', () => {
    const out = filterForwardHeaders({ 'x-api-key': 'inbound-key' }, 'proxy-key')
    expect(out['x-api-key']).toBe('proxy-key')
    expect(out['authorization']).toBeUndefined()
  })

  test('proxyApiKey not provided leaves headers untouched', () => {
    const out = filterForwardHeaders({ 'x-api-key': 'inbound-key' })
    expect(out['x-api-key']).toBe('inbound-key')
  })
})

// --- G2: 逻辑终止识别 + 收割接入（setupProxy 集成测试）---

// 构造集成测试用内存库：仅建 proxy.ts 运行路径触及的表
function createIntegrationDb(): Database.Database {
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      request_id TEXT UNIQUE NOT NULL,
      session_id TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      method TEXT NOT NULL,
      path TEXT NOT NULL,
      status_code INTEGER NOT NULL,
      response_time INTEGER NOT NULL,
      api_key TEXT,
      proxy_api_key TEXT,
      base_url TEXT,
      model TEXT,
      machine_id TEXT,
      user_agent TEXT,
      input_tokens INTEGER,
      output_tokens INTEGER,
      cache_read_tokens INTEGER,
      cache_creation_tokens INTEGER,
      request_headers TEXT,
      request_body TEXT,
      response_headers TEXT,
      response_events TEXT,
      completed_at TEXT,
      closed_at TEXT,
      error TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE response_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      request_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      event_index INTEGER NOT NULL,
      event_type TEXT,
      event_data TEXT NOT NULL
    );
    CREATE TABLE learn_tasks (
      task_id TEXT PRIMARY KEY,
      slug TEXT NOT NULL,
      source_type TEXT NOT NULL,
      label TEXT NOT NULL,
      status TEXT NOT NULL,
      error TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      ended_at TEXT
    );
    CREATE TABLE providers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      base_url TEXT,
      api_key TEXT,
      model TEXT,
      haiku_model TEXT,
      sonnet_model TEXT,
      opus_model TEXT,
      subagent_model TEXT,
      provider TEXT NOT NULL,
      is_default INTEGER NOT NULL DEFAULT 0,
      is_openai_compatible INTEGER NOT NULL DEFAULT 0,
      auth_style TEXT NOT NULL DEFAULT 'bearer',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `)
  return db
}

function sseFrame(event: string | null, data: unknown): string {
  const body = typeof data === 'string' ? data : JSON.stringify(data)
  return event !== null ? `event: ${event}\ndata: ${body}\n\n` : `data: ${body}\n\n`
}

const completeClaudeFrames = [
  sseFrame('message_start', { type: 'message_start', usage: { input_tokens: 10, cache_read_input_tokens: 2 } }),
  sseFrame('ping', { type: 'ping' }),
  sseFrame('message_delta', { type: 'message_delta', usage: { output_tokens: 4 } }),
  sseFrame('message_stop', { type: 'message_stop' })
]

const incompleteClaudeFrames = [
  sseFrame('message_start', { type: 'message_start', usage: { input_tokens: 3 } }),
  sseFrame('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }),
  sseFrame('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'hel' } })
]

// 上游 Web 流：逐帧异步入队；endAfter=false 时入队后保持悬挂（不 close）。
// singleChunk=true 时所有帧合并为一次 enqueue（模拟真实 TCP 合包，如
// finish_reason chunk 与紧随的 [DONE] 通常在同一缓冲到达）。
function createUpstreamWebStream(
  frames: string[],
  endAfter = false,
  singleChunk = false
): ReadableStream<Uint8Array> {
  let controller!: ReadableStreamDefaultController<Uint8Array>
  const webStream = new ReadableStream<Uint8Array>({
    start(c) { controller = c }
  })
  void (async () => {
    try {
      if (singleChunk) {
        controller.enqueue(Buffer.from(frames.join(''), 'utf-8'))
      } else {
        for (const frame of frames) {
          controller.enqueue(Buffer.from(frame, 'utf-8'))
          await new Promise(r => setTimeout(r, 3))
        }
      }
      if (endAfter) controller.close()
    } catch {
      // nodeStream.destroy 取消 web 流后 controller 已关闭，忽略后续入队
    }
  })()
  return webStream
}

async function waitFor<T>(
  predicate: () => T | undefined,
  { timeout = 3000, interval = 20 }: { timeout?: number; interval?: number } = {}
): Promise<T> {
  const start = Date.now()
  while (Date.now() - start < timeout) {
    const value = predicate()
    if (value !== undefined) return value
    await new Promise(r => setTimeout(r, interval))
  }
  throw new Error('waitFor timed out')
}

function mockUpstreamFetch(webStream: ReadableStream<Uint8Array>, requestId: string): jest.SpyInstance {
  return jest.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(webStream, {
    status: 200,
    headers: { 'content-type': 'text/event-stream', 'x-request-id': requestId }
  }))
}

// 挂一个假数据客户端捕获 WS 广播（request new/update 等）
let mockWs: { readyState: number; send: jest.Mock } | undefined

function attachMockWs(): any[] {
  const sent: any[] = []
  mockWs = {
    readyState: WebSocket.OPEN,
    send: jest.fn((payload: string) => { sent.push(JSON.parse(payload)) })
  }
  addDataClient(mockWs as any)
  return sent
}

const proxyConfig = {
  target: 'https://upstream.example.com/apps/anthropic',
  changeOrigin: true
} as any

const requestPayload = JSON.stringify({
  model: 'claude-sonnet-4-20250514',
  max_tokens: 16,
  messages: [{ role: 'user', content: 'hi' }]
})

describe('setupProxy SSE lifecycle (G2)', () => {
  let db: Database.Database
  let fastify: FastifyInstance

  beforeEach(() => {
    jest.clearAllMocks()
    db = createIntegrationDb()
    getDatabase.mockReturnValue(db)
    initDatabase.mockReturnValue(db)
    fastify = Fastify()
  })

  afterEach(async () => {
    delete process.env.CCM_STREAM_IDLE_TIMEOUT_MS
    if (mockWs) {
      removeDataClient(mockWs as any)
      mockWs = undefined
    }
    await fastify.close()
    db.close()
  })

  test('message_stop 已发出后上游悬挂：行落 completed_at，不标中断，客户端不悬挂', async () => {
    await setupProxy(fastify, proxyConfig)
    mockUpstreamFetch(createUpstreamWebStream(completeClaudeFrames), 'cloud-req-1')

    const response = await fastify.inject({
      method: 'POST',
      url: '/v1/messages',
      headers: { 'content-type': 'application/json' },
      payload: requestPayload
    })

    expect(response.statusCode).toBe(200)
    expect(response.payload).toContain('message_stop')

    const row = db.prepare('SELECT * FROM requests WHERE request_id = ?').get('cloud-req-1') as any
    expect(row).toBeDefined()
    expect(row.completed_at).not.toBeNull()
    expect(row.closed_at).toBeNull()
    expect(row.error).toBeNull()
  })

  test('无 message_stop 的 idle 超时仍标中断（closed_at + error）', async () => {
    // 测试专用时长覆盖：真实定时器，只缩短看门狗超时
    process.env.CCM_STREAM_IDLE_TIMEOUT_MS = '80'
    await setupProxy(fastify, proxyConfig)
    mockUpstreamFetch(createUpstreamWebStream(incompleteClaudeFrames), 'cloud-req-2')

    // 走真实 TCP：中断分支 pipe 不结束客户端（保持既有语义），客户端自行判超时
    await fastify.listen({ port: 0, host: '127.0.0.1' })
    const port = (fastify.server.address() as { port: number }).port

    const clientReq = http.request({
      port,
      host: '127.0.0.1',
      method: 'POST',
      path: '/v1/messages',
      headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(requestPayload) }
    })
    clientReq.on('error', () => { /* destroy 后预期 error，忽略 */ })
    clientReq.end(requestPayload)
    // 客户端收到数据后看门狗触发，不再有数据；保底 1s 后自毁连接
    const clientTimer = setTimeout(() => clientReq.destroy(), 1000)
    clientReq.on('close', () => clearTimeout(clientTimer))

    const row = await waitFor(() => {
      const r = db.prepare('SELECT * FROM requests LIMIT 1').get() as any
      return r && r.closed_at ? r : undefined
    })

    expect(row.completed_at).toBeNull()
    expect(row.closed_at).not.toBeNull()
    expect(row.error).toContain('idle timeout')
    expect(row.status_code).toBe(200)
  })

  test('OpenAI 流 finish_reason + [DONE] 后上游悬挂：行落 completed_at', async () => {
    db.prepare(`
      INSERT INTO providers (name, base_url, api_key, model, provider, is_default, is_openai_compatible, auth_style)
      VALUES ('openai-test', 'https://openai.example.com/v1', 'k', 'gpt-4o', 'openai', 1, 1, 'bearer')
    `).run()

    await setupProxy(fastify, proxyConfig)
    const openaiFrames = [
      sseFrame(null, { id: 'chat-1', choices: [{ delta: { role: 'assistant' }, finish_reason: null }] }),
      sseFrame(null, { id: 'chat-1', choices: [{ delta: { content: 'hi' }, finish_reason: null }] }),
      sseFrame(null, { id: 'chat-1', choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 5, completion_tokens: 7 } }),
      sseFrame(null, '[DONE]')
    ]
    const fetchSpy = mockUpstreamFetch(createUpstreamWebStream(openaiFrames, false, true), 'cloud-openai-1')

    const response = await fastify.inject({
      method: 'POST',
      url: '/v1/messages',
      headers: { 'content-type': 'application/json' },
      payload: requestPayload
    })

    expect(response.statusCode).toBe(200)
    expect(response.payload).toContain('message_stop')
    expect(fetchSpy.mock.calls[0][0]).toBe('https://openai.example.com/v1/chat/completions')

    const row = db.prepare('SELECT * FROM requests WHERE request_id = ?').get('cloud-openai-1') as any
    expect(row).toBeDefined()
    expect(row.completed_at).not.toBeNull()
    expect(row.closed_at).toBeNull()
    expect(row.error).toBeNull()
  })

  test('message_stop 到达后客户端断开：内容已完整交付，仍走 complete', async () => {
    await setupProxy(fastify, proxyConfig)
    mockUpstreamFetch(createUpstreamWebStream(completeClaudeFrames), 'cloud-req-3')

    await fastify.listen({ port: 0, host: '127.0.0.1' })
    const port = (fastify.server.address() as { port: number }).port

    await new Promise<void>((resolve, reject) => {
      const clientReq = http.request({
        port,
        host: '127.0.0.1',
        method: 'POST',
        path: '/v1/messages',
        headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(requestPayload) }
      })
      clientReq.on('error', () => { /* destroy 后预期 error，忽略 */ })
      clientReq.on('response', (res) => {
        res.on('data', (chunk: Buffer) => {
          if (chunk.toString().includes('message_stop')) clientReq.destroy()
        })
      })
      clientReq.on('close', () => resolve())
      setTimeout(() => reject(new Error('client did not close')), 3000).unref()
      clientReq.end(requestPayload)
    })

    const row = await waitFor(() => {
      const r = db.prepare('SELECT * FROM requests WHERE request_id = ?').get('cloud-req-3') as any
      return r && r.completed_at ? r : undefined
    })

    expect(row.closed_at).toBeNull()
    expect(row.error).toBeNull()
  })

  test('上游只返回 request-id 头（无 x-request-id）：completed 行取该值，WS update 的 pendingId 指向 local 行', async () => {
    await setupProxy(fastify, proxyConfig)
    const upstreamId = 'req_upstream_abc'
    jest.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(
      createUpstreamWebStream(completeClaudeFrames),
      { status: 200, headers: { 'content-type': 'text/event-stream', 'request-id': upstreamId } }
    ))
    const sent = attachMockWs()

    const response = await fastify.inject({
      method: 'POST',
      url: '/v1/messages',
      headers: { 'content-type': 'application/json' },
      payload: requestPayload
    })

    expect(response.statusCode).toBe(200)

    const row = db.prepare('SELECT * FROM requests WHERE request_id = ?').get(upstreamId) as any
    expect(row).toBeDefined()
    expect(row.completed_at).not.toBeNull()

    const localId = sent.find(m => m.type === 'request' && m.action === 'new')!.data.requestId
    const update = sent.find(m => m.type === 'request' && m.action === 'update' && m.data.requestId === upstreamId)!
    expect(update).toBeDefined()
    expect(update.data.pendingId).toBe(`unknown-session:${localId}`)
  })

  test('Claude 模式上游 204 且 body 为 null：行落终态、WS 收到 completed、不挂起', async () => {
    await setupProxy(fastify, proxyConfig)
    jest.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(null, {
      status: 204,
      headers: { 'x-request-id': 'cloud-204-1' }
    }))
    const sent = attachMockWs()

    const response = await fastify.inject({
      method: 'POST',
      url: '/v1/messages',
      headers: { 'content-type': 'application/json' },
      payload: requestPayload
    })

    expect(response.statusCode).toBe(204)

    const row = db.prepare('SELECT * FROM requests WHERE request_id = ?').get('cloud-204-1') as any
    expect(row).toBeDefined()
    expect(row.completed_at).not.toBeNull()
    expect(row.closed_at).toBeNull()
    expect(row.error).toBeNull()

    const update = sent.find(m => m.type === 'request' && m.action === 'update' && m.data.requestId === 'cloud-204-1')
    expect(update).toBeDefined()
  })

  test('OpenAI 模式上游 204 且 body 为 null：行落终态、WS 收到 completed、不挂起', async () => {
    db.prepare(`
      INSERT INTO providers (name, base_url, api_key, model, provider, is_default, is_openai_compatible, auth_style)
      VALUES ('openai-test', 'https://openai.example.com/v1', 'k', 'gpt-4o', 'openai', 1, 1, 'bearer')
    `).run()

    await setupProxy(fastify, proxyConfig)
    jest.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(null, {
      status: 204,
      headers: { 'x-request-id': 'cloud-204-openai' }
    }))
    const sent = attachMockWs()

    const response = await fastify.inject({
      method: 'POST',
      url: '/v1/messages',
      headers: { 'content-type': 'application/json' },
      payload: requestPayload
    })

    expect(response.statusCode).toBe(204)

    const row = db.prepare('SELECT * FROM requests WHERE request_id = ?').get('cloud-204-openai') as any
    expect(row).toBeDefined()
    expect(row.completed_at).not.toBeNull()
    expect(row.closed_at).toBeNull()

    const update = sent.find(m => m.type === 'request' && m.action === 'update' && m.data.requestId === 'cloud-204-openai')
    expect(update).toBeDefined()
  })
})

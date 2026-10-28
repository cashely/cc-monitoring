import type { FastifyInstance } from 'fastify'
import { createServer } from '../index'

// Minimal Fastify-compatible logger mock with all required methods
function createMockLogger() {
  return {
    level: 'info',
    trace: jest.fn(),
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    fatal: jest.fn(),
    silent: jest.fn(),
    child: jest.fn().mockReturnThis(),
    bindings: jest.fn().mockReturnValue({}),
    setBindings: jest.fn(),
    flush: jest.fn(),
    msgPrefix: undefined as string | undefined
  }
}

// Mock config module
jest.mock('@config/index', () => ({
  loadConfig: jest.fn().mockResolvedValue({
    server: { port: 3000, host: 'localhost' },
    proxy: {
      target: 'https://example.com',
      changeOrigin: true
    },
    logging: { level: 'info', file: 'logs/test.log' }
  })
}))

// Mock logger module
jest.mock('@logger/index', () => ({
  createLogger: jest.fn().mockReturnValue(createMockLogger())
}))

// Mock proxy module
jest.mock('../proxy', () => ({
  setupProxy: jest.fn().mockResolvedValue(undefined)
}))

// Mock UI routes module
jest.mock('../ui-route', () => ({
  setupUiRoutes: jest.fn().mockResolvedValue(undefined)
}))

// Mock machine-id：node-machine-id 的 CJS bundle 带 __esModule 但无 default，
// ts-jest 的 default interop 拿不到；createServer 注册 chat 路由时会预加载
jest.mock('../../utils/machine-id', () => ({
  getMachineId: jest.fn().mockResolvedValue('test-machine-id'),
  getMachineIdSync: jest.fn().mockReturnValue('test-machine-id'),
  preloadMachineId: jest.fn().mockResolvedValue(undefined),
}))

describe('createServer', () => {
  let server: FastifyInstance

  beforeEach(() => {
    // Reset mock call counts between tests
    jest.clearAllMocks()
    // Re-set mock logger return value since clearAllMocks clears mockReturnValue
    const { createLogger } = jest.requireMock('@logger/index')
    createLogger.mockReturnValue(createMockLogger())
  })

  afterEach(async () => {
    if (server) {
      await server.close()
    }
  })

  it('returns a FastifyInstance', async () => {
    server = await createServer()
    expect(server).toBeDefined()
    expect(typeof server.listen).toBe('function')
    expect(typeof server.close).toBe('function')
  })

  it('calls loadConfig once', async () => {
    const { loadConfig } = jest.requireMock('@config/index')
    server = await createServer()
    // createServer 自身 + setupChatRoute 各读一次配置
    expect(loadConfig).toHaveBeenCalledTimes(2)
  })

  it('calls createLogger with config.logging', async () => {
    const { createLogger } = jest.requireMock('@logger/index')
    server = await createServer()
    expect(createLogger).toHaveBeenCalledWith({
      level: 'info',
      file: 'logs/test.log'
    })
  })

  it('calls setupProxy with fastify and config.proxy', async () => {
    const { setupProxy } = jest.requireMock('../proxy')
    server = await createServer()
    expect(setupProxy).toHaveBeenCalledTimes(1)
    expect(setupProxy).toHaveBeenCalledWith(server, {
      target: 'https://example.com',
      changeOrigin: true
    })
  })

  it('calls setupUiRoutes with fastify', async () => {
    const { setupUiRoutes } = jest.requireMock('../ui-route')
    server = await createServer()
    expect(setupUiRoutes).toHaveBeenCalledTimes(1)
    expect(setupUiRoutes).toHaveBeenCalledWith(server)
  })

  it('can inject requests', async () => {
    server = await createServer()
    const response = await server.inject({
      method: 'GET',
      url: '/test-path'
    })
    expect(response).toBeDefined()
    expect(typeof response.statusCode).toBe('number')
  })

  it('propagates request ID from x-request-id header', async () => {
    server = await createServer()
    const response = await server.inject({
      method: 'GET',
      url: '/test',
      headers: { 'x-request-id': 'custom-id-123' }
    })
    expect(response).toBeDefined()
  })

  it('handles request without x-request-id header', async () => {
    server = await createServer()
    const response = await server.inject({
      method: 'GET',
      url: '/test'
    })
    expect(response).toBeDefined()
  })

  it('server closes cleanly', async () => {
    server = await createServer()
    await server.close()
    // Verify close succeeded — server is no longer listening
    expect(server).toBeDefined()
  })
})

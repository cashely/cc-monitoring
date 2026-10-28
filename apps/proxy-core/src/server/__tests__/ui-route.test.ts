import type { FastifyInstance } from 'fastify'
import Fastify from 'fastify'
import { setupUiRoutes } from '../ui-route'

// Mock PM2 utils
jest.mock('@utils/pm2', () => ({
  getProcessStatus: jest.fn()
}))

// Mock pi-coding-agent：真实包是纯 ESM 且 exports 无 require 条件，jest CJS 无法加载。
// 这些用例不触发 createPiSession，仅需让 pi-runtime 模块顶层导入可解析。
jest.mock('@earendil-works/pi-coding-agent', () => ({
  createAgentSession: jest.fn(),
  DefaultResourceLoader: jest.fn(),
  ModelRuntime: { create: jest.fn() },
  createWriteToolDefinition: jest.fn(),
}), { virtual: true })

// esm-dirname is mocked via moduleNameMapper in jest.config.cjs (uses import.meta.url)

// Mock config module
jest.mock('@config/index', () => ({
  loadConfig: jest.fn().mockResolvedValue({
    server: { port: 3000, host: 'localhost' },
    proxy: {
      target: 'https://example.com',
      changeOrigin: true
    },
    logging: { level: 'info', file: 'logs/test.log' }
  }),
  saveConfig: jest.fn().mockResolvedValue(undefined)
}))

// Mock config schema
jest.mock('@config/schema', () => ({
  validateConfig: jest.fn().mockReturnValue({
    valid: true,
    data: {
      server: { port: 3000, host: 'localhost' },
      proxy: { target: 'https://example.com', changeOrigin: true },
      logging: { level: 'info', file: 'logs/test.log' }
    }
  }),
  AppConfigSchema: {}
}))

// Mock @fastify/websocket
jest.mock('@fastify/websocket', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation((fastify, opts, done) => {
    fastify.decorate('websocketServer', {})
    done()
  })
}))

// Mock @fastify/static — skip static file serving in tests
jest.mock('@fastify/static', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation((fastify, opts, done) => {
    done()
  })
}))

// Mock fs for log streaming
jest.mock('fs', () => ({
  ...jest.requireActual('fs'),
  promises: {
    ...jest.requireActual('fs').promises,
    access: jest.fn().mockRejectedValue(new Error('ENOENT')),
    readFile: jest.fn().mockResolvedValue('')
  },
  watch: jest.fn().mockReturnValue({ close: jest.fn() })
}))

describe('setupUiRoutes', () => {
  let server: FastifyInstance

  beforeEach(async () => {
    jest.clearAllMocks()
    // Clear any env token
    delete process.env.UI_AUTH_TOKEN
    server = Fastify({ logger: false })
    await setupUiRoutes(server)
  })

  afterEach(async () => {
    if (server) {
      await server.close()
    }
  })

  describe('GET /ui/api/status', () => {
    it('returns stopped status when PM2 process not found', async () => {
      const { getProcessStatus } = jest.requireMock('@utils/pm2')
      getProcessStatus.mockResolvedValue(null)

      const response = await server.inject({
        method: 'GET',
        url: '/ui/api/status'
      })

      expect(response.statusCode).toBe(200)
      const body = JSON.parse(response.body)
      expect(body.status).toBe('stopped')
      expect(body.cpu).toBe(0)
      expect(body.memory).toBe(0)
      expect(body.uptime).toBe(0)
      expect(body.restarts).toBe(0)
    })

    it('returns process status when PM2 process is running', async () => {
      const { getProcessStatus } = jest.requireMock('@utils/pm2')
      getProcessStatus.mockResolvedValue({
        name: 'cc-monitoring',
        status: 'online',
        cpu: 5.2,
        memory: 104857600,
        uptime: 123456789,
        restarts: 2
      })

      const response = await server.inject({
        method: 'GET',
        url: '/ui/api/status'
      })

      expect(response.statusCode).toBe(200)
      const body = JSON.parse(response.body)
      expect(body.status).toBe('online')
      expect(body.cpu).toBe(5.2)
      expect(body.memory).toBe(104857600)
      expect(body.uptime).toBe(123456789)
      expect(body.restarts).toBe(2)
    })

    it('calls getProcessStatus with "claude-proxy"', async () => {
      const { getProcessStatus } = jest.requireMock('@utils/pm2')
      getProcessStatus.mockResolvedValue(null)

      await server.inject({
        method: 'GET',
        url: '/ui/api/status'
      })

      expect(getProcessStatus).toHaveBeenCalledWith('cc-monitoring')
    })
  })

  describe('GET /ui/api/config', () => {
    it('returns current config', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/ui/api/config'
      })

      expect(response.statusCode).toBe(200)
      const body = JSON.parse(response.body)
      expect(body.config).toBeDefined()
      expect(body.config.server).toBeDefined()
      expect(body.config.server.port).toBe(3000)
      expect(body.config.server.host).toBe('localhost')
    })

    it('calls loadConfig on GET request', async () => {
      const { loadConfig } = jest.requireMock('@config/index')
      const callCountBefore = loadConfig.mock.calls.length

      await server.inject({
        method: 'GET',
        url: '/ui/api/config'
      })

      // loadConfig is called once during setupUiRoutes + once in the handler
      expect(loadConfig.mock.calls.length).toBe(callCountBefore + 1)
    })
  })

  describe('POST /ui/api/config', () => {
    it('returns success when config is valid and no auth required', async () => {
      const { validateConfig } = jest.requireMock('@config/schema')
      validateConfig.mockReturnValue({
        valid: true,
        data: {
          server: { port: 4000, host: '0.0.0.0' },
          proxy: { target: 'https://newtarget.com', changeOrigin: true },
          logging: { level: 'debug', file: 'logs/new.log' }
        }
      })

      const response = await server.inject({
        method: 'POST',
        url: '/ui/api/config',
        payload: {
          server: { port: 4000, host: '0.0.0.0' },
          proxy: { target: 'https://newtarget.com', changeOrigin: true },
          logging: { level: 'debug', file: 'logs/new.log' }
        }
      })

      expect(response.statusCode).toBe(200)
      const body = JSON.parse(response.body)
      expect(body.success).toBe(true)
    })

    it('returns 400 when config is invalid', async () => {
      const { validateConfig } = jest.requireMock('@config/schema')
      validateConfig.mockReturnValue({
        valid: false,
        errors: [
          { field: 'server.port', message: 'Expected number, received string' }
        ]
      })

      const response = await server.inject({
        method: 'POST',
        url: '/ui/api/config',
        payload: {
          server: { port: 'invalid' }
        }
      })

      expect(response.statusCode).toBe(400)
      const body = JSON.parse(response.body)
      expect(body.success).toBe(false)
      expect(body.errors).toBeDefined()
      expect(body.errors.length).toBeGreaterThan(0)
    })

    it('calls saveConfig with validated data', async () => {
      const { validateConfig } = jest.requireMock('@config/schema')
      const { saveConfig } = jest.requireMock('@config/index')
      const validatedData = {
        server: { port: 4000, host: '0.0.0.0' },
        proxy: { target: 'https://newtarget.com', changeOrigin: true },
        logging: { level: 'debug', file: 'logs/new.log' }
      }
      validateConfig.mockReturnValue({ valid: true, data: validatedData })

      await server.inject({
        method: 'POST',
        url: '/ui/api/config',
        payload: validatedData
      })

      expect(saveConfig).toHaveBeenCalledWith(validatedData)
    })

    it('returns 401 when auth token configured but no Authorization header', async () => {
      // Set auth token in config via loadConfig mock
      const { loadConfig } = jest.requireMock('@config/index')
      loadConfig.mockResolvedValue({
        server: { port: 3000, host: 'localhost' },
        proxy: { target: 'https://example.com', changeOrigin: true },
        logging: { level: 'info', file: 'logs/test.log' },
        auth: { token: 'secret123' }
      })

      // Need to recreate server with new config
      const newServer = Fastify({ logger: false })
      await setupUiRoutes(newServer)

      const { validateConfig } = jest.requireMock('@config/schema')
      validateConfig.mockReturnValue({
        valid: true,
        data: {
          server: { port: 4000, host: '0.0.0.0' },
          proxy: { target: 'https://newtarget.com', changeOrigin: true },
          logging: { level: 'debug', file: 'logs/new.log' }
        }
      })

      const response = await newServer.inject({
        method: 'POST',
        url: '/ui/api/config',
        payload: {
          server: { port: 4000, host: '0.0.0.0' },
          proxy: { target: 'https://newtarget.com', changeOrigin: true },
          logging: { level: 'debug', file: 'logs/new.log' }
        }
      })

      expect(response.statusCode).toBe(401)
      const body = JSON.parse(response.body)
      expect(body.success).toBe(false)
      expect(body.error).toContain('Unauthorized')

      await newServer.close()
    })

    it('returns 401 when auth token configured but wrong token provided', async () => {
      const { loadConfig } = jest.requireMock('@config/index')
      loadConfig.mockResolvedValue({
        server: { port: 3000, host: 'localhost' },
        proxy: { target: 'https://example.com', changeOrigin: true },
        logging: { level: 'info', file: 'logs/test.log' },
        auth: { token: 'secret123' }
      })

      const newServer = Fastify({ logger: false })
      await setupUiRoutes(newServer)

      const { validateConfig } = jest.requireMock('@config/schema')
      validateConfig.mockReturnValue({
        valid: true,
        data: {
          server: { port: 4000, host: '0.0.0.0' },
          proxy: { target: 'https://newtarget.com', changeOrigin: true },
          logging: { level: 'debug', file: 'logs/new.log' }
        }
      })

      const response = await newServer.inject({
        method: 'POST',
        url: '/ui/api/config',
        headers: { authorization: 'Bearer wrongtoken' },
        payload: {
          server: { port: 4000, host: '0.0.0.0' },
          proxy: { target: 'https://newtarget.com', changeOrigin: true },
          logging: { level: 'debug', file: 'logs/new.log' }
        }
      })

      expect(response.statusCode).toBe(401)

      await newServer.close()
    })

    it('returns 200 when correct Bearer token provided', async () => {
      const { loadConfig } = jest.requireMock('@config/index')
      loadConfig.mockResolvedValue({
        server: { port: 3000, host: 'localhost' },
        proxy: { target: 'https://example.com', changeOrigin: true },
        logging: { level: 'info', file: 'logs/test.log' },
        auth: { token: 'secret123' }
      })

      const newServer = Fastify({ logger: false })
      await setupUiRoutes(newServer)

      const { validateConfig } = jest.requireMock('@config/schema')
      validateConfig.mockReturnValue({
        valid: true,
        data: {
          server: { port: 4000, host: '0.0.0.0' },
          proxy: { target: 'https://newtarget.com', changeOrigin: true },
          logging: { level: 'debug', file: 'logs/new.log' }
        }
      })

      const response = await newServer.inject({
        method: 'POST',
        url: '/ui/api/config',
        headers: { authorization: 'Bearer secret123' },
        payload: {
          server: { port: 4000, host: '0.0.0.0' },
          proxy: { target: 'https://newtarget.com', changeOrigin: true },
          logging: { level: 'debug', file: 'logs/new.log' }
        }
      })

      expect(response.statusCode).toBe(200)
      const body = JSON.parse(response.body)
      expect(body.success).toBe(true)

      await newServer.close()
    })

    it('returns 200 when env token matches and no config auth', async () => {
      process.env.UI_AUTH_TOKEN = 'envtoken'
      const { loadConfig } = jest.requireMock('@config/index')
      // Config has no auth section
      loadConfig.mockResolvedValue({
        server: { port: 3000, host: 'localhost' },
        proxy: { target: 'https://example.com', changeOrigin: true },
        logging: { level: 'info', file: 'logs/test.log' }
      })

      const newServer = Fastify({ logger: false })
      await setupUiRoutes(newServer)

      const { validateConfig } = jest.requireMock('@config/schema')
      validateConfig.mockReturnValue({
        valid: true,
        data: {
          server: { port: 4000, host: '0.0.0.0' },
          proxy: { target: 'https://newtarget.com', changeOrigin: true },
          logging: { level: 'debug', file: 'logs/new.log' }
        }
      })

      const response = await newServer.inject({
        method: 'POST',
        url: '/ui/api/config',
        headers: { authorization: 'Bearer envtoken' },
        payload: {
          server: { port: 4000, host: '0.0.0.0' },
          proxy: { target: 'https://newtarget.com', changeOrigin: true },
          logging: { level: 'debug', file: 'logs/new.log' }
        }
      })

      expect(response.statusCode).toBe(200)

      await newServer.close()
      delete process.env.UI_AUTH_TOKEN
    })

    it('returns 500 when saveConfig throws', async () => {
      const { saveConfig } = jest.requireMock('@config/index')
      const { validateConfig } = jest.requireMock('@config/schema')
      validateConfig.mockReturnValue({
        valid: true,
        data: {
          server: { port: 4000, host: '0.0.0.0' },
          proxy: { target: 'https://newtarget.com', changeOrigin: true },
          logging: { level: 'debug', file: 'logs/new.log' }
        }
      })
      saveConfig.mockRejectedValue(new Error('Disk write failed'))

      const response = await server.inject({
        method: 'POST',
        url: '/ui/api/config',
        payload: {
          server: { port: 4000, host: '0.0.0.0' },
          proxy: { target: 'https://newtarget.com', changeOrigin: true },
          logging: { level: 'debug', file: 'logs/new.log' }
        }
      })

      expect(response.statusCode).toBe(500)
      const body = JSON.parse(response.body)
      expect(body.success).toBe(false)
      expect(body.error).toContain('Disk write failed')
    })
  })
})

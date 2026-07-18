import type { FastifyInstance } from 'fastify'
import Fastify from 'fastify'
import Database from 'better-sqlite3'
import { setupProvidersRoutes } from '../providers-route'
import { listProviders, saveProviders, validateProviders } from '@utils/providers-db'

// Mock PM2 utils (unused but required by ui-route if loaded)
jest.mock('@utils/pm2', () => ({
  getProcessStatus: jest.fn()
}))

// Mock config module
jest.mock('@config/index', () => ({
  loadConfig: jest.fn().mockResolvedValue({
    server: { port: 3000, host: 'localhost' },
    proxy: { target: 'https://example.com', changeOrigin: true },
    logging: { level: 'info', file: 'logs/test.log' }
  }),
  saveConfig: jest.fn().mockResolvedValue(undefined)
}))

// Mock config schema (unused by providers route but may be loaded)
jest.mock('@config/schema', () => ({
  validateConfig: jest.fn().mockReturnValue({
    valid: true,
    data: {}
  }),
  AppConfigSchema: {}
}))

// Mock @fastify/static
jest.mock('@fastify/static', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation((fastify, opts, done) => {
    done()
  })
}))

// Mock database module
jest.mock('@utils/db', () => {
  const mockDb = new Database(':memory:')
  mockDb.pragma('journal_mode = WAL')
  mockDb.exec(`CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY)`)
  // Apply providers schema directly
  mockDb.exec(`
    CREATE TABLE IF NOT EXISTS providers (
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
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `)
  mockDb.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_providers_name ON providers(name)`)
  mockDb.prepare('INSERT OR REPLACE INTO schema_version (version) VALUES (2)').run()
  return {
    __esModule: true,
    initDatabase: jest.fn().mockReturnValue(mockDb),
    getDatabase: jest.fn().mockReturnValue(mockDb),
    closeDatabase: jest.fn(),
    applySchemaV2: jest.fn()
  }
})

// Import the mocked getDatabase so tests can access it
const { getDatabase } = jest.requireMock('@utils/db')

// Mock fs for WebSocket log streaming
jest.mock('fs', () => ({
  ...jest.requireActual('fs'),
  promises: {
    ...jest.requireActual('fs').promises,
    access: jest.fn().mockRejectedValue(new Error('ENOENT')),
    readFile: jest.fn().mockResolvedValue('')
  },
  watch: jest.fn().mockReturnValue({ close: jest.fn() })
}))

describe('Providers API', () => {
  let server: FastifyInstance

  beforeEach(async () => {
    jest.clearAllMocks()
    delete process.env.UI_AUTH_TOKEN
    server = Fastify({ logger: false })
    await setupProvidersRoutes(server, { server: { port: 3000, host: 'localhost' }, proxy: { target: 'https://example.com', changeOrigin: true }, logging: { level: 'info', file: 'logs/test.log' } })
  })

  afterEach(async () => {
    if (server) {
      await server.close()
    }
  })

  describe('GET /ui/api/providers', () => {
    it('returns empty array initially', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/ui/api/providers'
      })

      expect(response.statusCode).toBe(200)
      const body = JSON.parse(response.body)
      expect(body.providers).toEqual([])
    })

    it('returns default field for providers', async () => {
      const db = getDatabase()
      db.prepare(
        `INSERT INTO providers (name, base_url, api_key, model, provider, is_default)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).run('active', 'https://a.com', 'key', 'm', 'anthropic', 1)

      const response = await server.inject({
        method: 'GET',
        url: '/ui/api/providers'
      })

      expect(response.statusCode).toBe(200)
      const body = JSON.parse(response.body)
      expect(body.providers[0].default).toBe(true)
    })
  })

  describe('POST /ui/api/providers', () => {
    it('saves valid providers', async () => {
      const providers = [
        { name: 'new-p1', base_url: 'https://api.anthropic.com', api_key: 'sk-1', model: 'claude-3.5-sonnet', provider: 'anthropic' }
      ]

      const response = await server.inject({
        method: 'POST',
        url: '/ui/api/providers',
        payload: { providers }
      })

      expect(response.statusCode).toBe(200)
      const body = JSON.parse(response.body)
      expect(body.success).toBe(true)
    })

    it('rejects duplicate names', async () => {
      const providers = [
        { name: 'dup', base_url: 'https://a.com', api_key: 'k1', model: 'm1', provider: 'anthropic' },
        { name: 'dup', base_url: 'https://b.com', api_key: 'k2', model: 'm2', provider: 'openai' }
      ]

      const response = await server.inject({
        method: 'POST',
        url: '/ui/api/providers',
        payload: { providers }
      })

      expect(response.statusCode).toBe(400)
      const body = JSON.parse(response.body)
      expect(body.success).toBe(false)
      expect(body.errors.some((e: any) => e.field === 'name' && e.message.includes('duplicate'))).toBe(true)
    })

    it('rejects invalid base_url', async () => {
      const providers = [
        { name: 'bad-url', base_url: 'not-a-url', api_key: 'k1', model: 'm1', provider: 'anthropic' }
      ]

      const response = await server.inject({
        method: 'POST',
        url: '/ui/api/providers',
        payload: { providers }
      })

      expect(response.statusCode).toBe(400)
      const body = JSON.parse(response.body)
      expect(body.success).toBe(false)
      expect(body.errors.some((e: any) => e.field === 'base_url')).toBe(true)
    })

    it('rejects missing required fields', async () => {
      const providers = [
        { name: '', base_url: '', api_key: '', model: '', provider: '' }
      ]

      const response = await server.inject({
        method: 'POST',
        url: '/ui/api/providers',
        payload: { providers }
      })

      expect(response.statusCode).toBe(400)
      const body = JSON.parse(response.body)
      expect(body.success).toBe(false)
      expect(body.errors.length).toBeGreaterThanOrEqual(2) // Should have at least name and provider errors plus optional field validation
    })

    it('requires auth when token configured', async () => {
      // Set auth token in config
      const authConfig = {
        server: { port: 3000, host: 'localhost' },
        proxy: { target: 'https://example.com', changeOrigin: true },
        logging: { level: 'info', file: 'logs/test.log' },
        auth: { token: 'secret123' }
      }
      const authServer = Fastify({ logger: false })
      await setupProvidersRoutes(authServer, authConfig)

      const response = await authServer.inject({
        method: 'POST',
        url: '/ui/api/providers',
        payload: { providers: [{ name: 'p', base_url: 'https://a.com', api_key: 'k', model: 'm', provider: 'anthropic' }] }
      })

      expect(response.statusCode).toBe(401)
      const body = JSON.parse(response.body)
      expect(body.success).toBe(false)
      expect(body.error).toContain('Unauthorized')

      await authServer.close()
    })

    it('persists default flag through save', async () => {
      const providers = [
        { name: 'p1', base_url: 'https://a.com', api_key: 'k1', model: 'm', provider: 'anthropic', default: true },
        { name: 'p2', base_url: 'https://b.com', api_key: 'k2', model: 'm', provider: 'anthropic' }
      ]

      const response = await server.inject({
        method: 'POST',
        url: '/ui/api/providers',
        payload: { providers }
      })

      expect(response.statusCode).toBe(200)

      const getResponse = await server.inject({ method: 'GET', url: '/ui/api/providers' })
      const body = JSON.parse(getResponse.body)
      const p1 = body.providers.find((p: any) => p.name === 'p1')
      const p2 = body.providers.find((p: any) => p.name === 'p2')
      expect(p1.default).toBe(true)
      expect(p2.default).toBe(false)
    })

    it('rejects multiple default=true with 400', async () => {
      const providers = [
        { name: 'p1', base_url: 'https://a.com', api_key: 'k1', model: 'm', provider: 'anthropic', default: true },
        { name: 'p2', base_url: 'https://b.com', api_key: 'k2', model: 'm', provider: 'openai', default: true }
      ]

      const response = await server.inject({
        method: 'POST',
        url: '/ui/api/providers',
        payload: { providers }
      })

      expect(response.statusCode).toBe(400)
      const body = JSON.parse(response.body)
      expect(body.errors.some((e: any) => e.field === 'default')).toBe(true)
    })
  })
})

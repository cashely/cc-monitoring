import { getErrorStatusCode, getErrorMessage, resolveProxyTarget } from '../proxy'
import Database from 'better-sqlite3'

jest.mock('@utils/db', () => ({
  __esModule: true,
  getDatabase: jest.fn(),
  initDatabase: jest.fn(),
  closeDatabase: jest.fn()
}))

const { getDatabase } = jest.requireMock('@utils/db') as { getDatabase: jest.Mock }

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
    db.exec(`CREATE TABLE providers (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE NOT NULL, base_url TEXT, api_key TEXT, model TEXT, haiku_model TEXT, sonnet_model TEXT, opus_model TEXT, subagent_model TEXT, provider TEXT NOT NULL, is_default INTEGER NOT NULL DEFAULT 0, is_openai_compatible INTEGER NOT NULL DEFAULT 0, created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP)`)
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
})

import { saveRequestDB, loadRequestDB, listRequestDB, cleanOldRequestsDB } from '../request-writer.js'
import { initDatabase, closeDatabase } from '../db.js'
import fs from 'fs/promises'

describe('request-writer-db', () => {
  beforeAll(() => {
    initDatabase()
  })

  afterAll(() => {
    closeDatabase()
  })

  it('should save request data to SQLite', async () => {
    const data = {
      requestId: 'test-123',
      sessionId: 'session-1',
      timestamp: '2026-06-22T10:00:00Z',
      apiKey: 'original-key',
      proxyApiKey: 'proxy-key',
      baseUrl: 'https://example.com',
      model: 'claude-3-5-sonnet',
      request: {
        method: 'POST',
        path: '/v1/messages',
        headers: { 'content-type': 'application/json' },
        body: { test: true }
      },
      response: {
        statusCode: 200,
        events: [{ type: 'test' }]
      }
    }

    await saveRequestDB('session-1', 'test-123', data)

    const loaded = await loadRequestDB('session-1:test-123')
    expect(loaded.requestId).toBe('test-123')
    expect(loaded.sessionId).toBe('session-1')
    expect(loaded.apiKey).toBe('original-key')
    expect(loaded.proxyApiKey).toBe('proxy-key')
    expect(loaded.baseUrl).toBe('https://example.com')
    expect(loaded.model).toBe('claude-3-5-sonnet')
  })

  it('should list requests summary', async () => {
    const summaries = await listRequestDB()
    expect(summaries.length).toBeGreaterThan(0)
    expect(summaries[0].compositeId).toBeDefined()
  })

  it('should clean old requests', async () => {
    await cleanOldRequestsDB(7)
    // Should not throw
  })
})

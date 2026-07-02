import fs from 'fs/promises'
import path from 'path'
import { createLogger, readLogs } from '../index'
import type { LogConfig } from '../../types/config'

const LOG_CONFIG: LogConfig = { level: 'info', file: 'logs/test-proxy.log' }

describe('createLogger', () => {
  it('creates a pino logger with the configured level', () => {
    const logger = createLogger(LOG_CONFIG)
    expect(logger).toBeDefined()
    expect(logger.level).toBe('info')
  })

  it('respects debug level', () => {
    const debugConfig: LogConfig = { level: 'debug', file: 'logs/test-debug.log' }
    const logger = createLogger(debugConfig)
    expect(logger.level).toBe('debug')
  })

  it('respects warn level', () => {
    const warnConfig: LogConfig = { level: 'warn', file: 'logs/test-warn.log' }
    const logger = createLogger(warnConfig)
    expect(logger.level).toBe('warn')
  })

  it('respects error level', () => {
    const errorConfig: LogConfig = { level: 'error', file: 'logs/test-error.log' }
    const logger = createLogger(errorConfig)
    expect(logger.level).toBe('error')
  })
})

describe('readLogs', () => {
  const tmpDir = path.join(process.cwd(), '__test_logs_tmp__')
  const logPath = path.join(tmpDir, 'test.log')

  // pino uses numeric levels: 10=trace, 20=debug, 30=info, 40=warn, 50=error, 60=fatal
  const LOG_LINES = [
    JSON.stringify({ level: 30, time: '2024-01-01T00:00:00.000Z', msg: 'Server started' }),
    JSON.stringify({ level: 20, time: '2024-01-01T00:01:00.000Z', msg: 'Request details' }),
    JSON.stringify({ level: 30, time: '2024-01-01T00:02:00.000Z', msg: 'Proxy forwarded' }),
    JSON.stringify({ level: 50, time: '2024-01-01T00:03:00.000Z', msg: 'Connection failed' }),
    JSON.stringify({ level: 40, time: '2024-01-01T00:04:00.000Z', msg: 'Slow response' }),
    JSON.stringify({ level: 30, time: '2024-01-01T00:05:00.000Z', msg: 'Request completed with auth' }),
  ]

  beforeAll(async () => {
    await fs.mkdir(tmpDir, { recursive: true })
    await fs.writeFile(logPath, LOG_LINES.join('\n'))
  })

  afterAll(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  it('reads all lines without filters', async () => {
    const lines = await readLogs(logPath, {})
    expect(lines.length).toBe(6)
  })

  it('filters by info level (numeric 30)', async () => {
    const lines = await readLogs(logPath, { level: 'info' })
    expect(lines.length).toBe(3)
    for (const line of lines) {
      const parsed = JSON.parse(line)
      expect(parsed.level).toBe(30)
    }
  })

  it('filters by error level (numeric 50)', async () => {
    const lines = await readLogs(logPath, { level: 'error' })
    expect(lines.length).toBe(1)
    const parsed = JSON.parse(lines[0])
    expect(parsed.msg).toBe('Connection failed')
  })

  it('filters by warn level (numeric 40)', async () => {
    const lines = await readLogs(logPath, { level: 'warn' })
    expect(lines.length).toBe(1)
    const parsed = JSON.parse(lines[0])
    expect(parsed.msg).toBe('Slow response')
  })

  it('filters by grep (case-insensitive)', async () => {
    const lines = await readLogs(logPath, { grep: 'AUTH' })
    expect(lines.length).toBe(1)
    expect(lines[0]).toContain('auth')
  })

  it('filters by grep matching multiple lines', async () => {
    const lines = await readLogs(logPath, { grep: 'request' })
    expect(lines.length).toBe(2) // "Request details" and "Request completed"
  })

  it('applies limit returning last N lines', async () => {
    const lines = await readLogs(logPath, { limit: 2 })
    expect(lines.length).toBe(2)
    const last = JSON.parse(lines[1])
    expect(last.msg).toBe('Request completed with auth')
  })

  it('combines level and grep filters', async () => {
    const lines = await readLogs(logPath, { level: 'info', grep: 'proxy' })
    expect(lines.length).toBe(1)
    const parsed = JSON.parse(lines[0])
    expect(parsed.level).toBe(30)
    expect(parsed.msg).toBe('Proxy forwarded')
  })

  it('combines limit with other filters', async () => {
    const lines = await readLogs(logPath, { level: 'info', limit: 1 })
    expect(lines.length).toBe(1)
    const parsed = JSON.parse(lines[0])
    expect(parsed.msg).toBe('Request completed with auth')
  })

  it('returns empty array when no lines match level', async () => {
    const lines = await readLogs(logPath, { level: 'trace' })
    expect(lines.length).toBe(0)
  })

  it('returns empty array when no lines match grep', async () => {
    const lines = await readLogs(logPath, { grep: 'nonexistent' })
    expect(lines.length).toBe(0)
  })

  it('throws for non-existent file', async () => {
    await expect(readLogs(path.join(tmpDir, 'no-file.log'), {})).rejects.toThrow()
  })

  it('skips non-JSON lines when filtering by level', async () => {
    const mixedPath = path.join(tmpDir, 'mixed.log')
    const mixedLines = [
      'this is not json',
      JSON.stringify({ level: 30, msg: 'valid entry' }),
      'another non-json line'
    ]
    await fs.writeFile(mixedPath, mixedLines.join('\n'))
    const lines = await readLogs(mixedPath, { level: 'info' })
    expect(lines.length).toBe(1)
    const parsed = JSON.parse(lines[0])
    expect(parsed.msg).toBe('valid entry')
  })
})

import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import path from 'path'
import { configureDbPath, initDatabase, closeDatabase, getDatabase } from '../db.js'
import { startDbWorker, stopDbWorker } from '../db-worker-client.js'
import { aggregateStats, getStatsData, getTodayStats } from '../stats-aggregator.js'

let counter = 0

interface InsertOptions {
  timestamp: string
  inputTokens?: number
  outputTokens?: number
  cacheReadTokens?: number
  cacheCreationTokens?: number
  closedAt?: string | null
  model?: string | null
}

// 直接往 requests 表插行，绕过 request-writer，聚焦聚合口径
function insertRequest(opts: InsertOptions): void {
  counter += 1
  getDatabase()
    .prepare(`
      INSERT INTO requests (
        request_id, session_id, timestamp, method, path, status_code, response_time,
        model, input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens, closed_at
      ) VALUES (?, ?, ?, 'POST', '/v1/messages', 200, 100, ?, ?, ?, ?, ?, ?)
    `)
    .run(
      `req_${counter}`,
      `sess_${counter}`,
      opts.timestamp,
      opts.model ?? null,
      opts.inputTokens ?? null,
      opts.outputTokens ?? null,
      opts.cacheReadTokens ?? null,
      opts.cacheCreationTokens ?? null,
      opts.closedAt ?? null
    )
}

// 直接往 stats 账本写桶（模拟历史冻结桶 / deleteBefore 目标）
function insertStatsBucket(opts: {
  key: string
  inputTokens?: number
  outputTokens?: number
  requestCount?: number
  updatedAt?: string
}): void {
  getDatabase()
    .prepare(`
      INSERT INTO stats (
        period, period_key, input_tokens, output_tokens,
        cache_read_tokens, cache_creation_tokens, request_count, updated_at
      ) VALUES ('hourly', ?, ?, ?, 0, 0, ?, ?)
    `)
    .run(
      opts.key,
      opts.inputTokens ?? 0,
      opts.outputTokens ?? 0,
      opts.requestCount ?? 0,
      opts.updatedAt ?? '2000-01-01 00:00:00'
    )
}

function hourKeyOf(iso: string): string {
  const d = new Date(iso)
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}-${String(d.getUTCHours()).padStart(2, '0')}`
}

function shiftedKey(daysAgo: number): string {
  return hourKeyOf(new Date(Date.now() - daysAgo * 86400000).toISOString())
}

describe('stats-aggregator', () => {
  let tempDir: string
  let dbPath: string

  beforeEach(() => {
    tempDir = mkdtempSync(path.join(tmpdir(), 'ccm-stats-'))
    dbPath = path.join(tempDir, 'test.db')
    // 主线程先建库（schema + migration），worker 启动后同库开独立连接
    configureDbPath(dbPath)
    initDatabase()
    startDbWorker(dbPath)
  })

  afterEach(async () => {
    await stopDbWorker()
    closeDatabase()
    rmSync(tempDir, { recursive: true, force: true })
  })

  it('worker 启停：聚合当前小时 + 前 3 个关门小时（共 4 桶）', async () => {
    const nowIso = new Date().toISOString()
    const ts2h = new Date(Date.now() - 2 * 3600000).toISOString()
    const ts3h = new Date(Date.now() - 3 * 3600000).toISOString()
    insertRequest({ timestamp: nowIso, inputTokens: 100, outputTokens: 20 })
    insertRequest({ timestamp: ts2h, inputTokens: 5 })
    insertRequest({ timestamp: ts3h, inputTokens: 7 })

    await aggregateStats()
    const stats = await getStatsData()
    expect(stats.hourly[hourKeyOf(nowIso)]).toMatchObject({ input_tokens: 100, output_tokens: 20, request_count: 1 })
    expect(stats.hourly[hourKeyOf(ts2h)]).toMatchObject({ input_tokens: 5, request_count: 1 })
    expect(stats.hourly[hourKeyOf(ts3h)]).toMatchObject({ input_tokens: 7, request_count: 1 })
  })

  it('只重算最近 4 桶：5 小时前的源行不产生账本桶（不做全窗口重算）', async () => {
    const ts5h = new Date(Date.now() - 5 * 3600000).toISOString()
    insertRequest({ timestamp: ts5h, inputTokens: 50 })

    await aggregateStats()
    const stats = await getStatsData()
    expect(stats.hourly[hourKeyOf(ts5h)]).toBeUndefined()
  })

  it('冻结桶不被改动：更早的旧桶保留原值，即使源行不存在', async () => {
    const frozenKey = shiftedKey(10)
    insertStatsBucket({ key: frozenKey, inputTokens: 999, outputTokens: 888, requestCount: 42 })

    await aggregateStats(undefined, 90)
    const row = getDatabase()
      .prepare('SELECT * FROM stats WHERE period = ? AND period_key = ?')
      .get('hourly', frozenKey) as any
    expect(row.input_tokens).toBe(999)
    expect(row.output_tokens).toBe(888)
    expect(row.request_count).toBe(42)
    expect(row.updated_at).toBe('2000-01-01 00:00:00')
  })

  it('关门小时桶随迟到请求修正：DELETE + 聚合重插对应桶', async () => {
    const ts1h = new Date(Date.now() - 3600000).toISOString()
    const key = hourKeyOf(ts1h)

    await aggregateStats()
    expect((await getStatsData()).hourly[key]).toBeUndefined()

    insertRequest({ timestamp: ts1h, inputTokens: 33, outputTokens: 4 })
    await aggregateStats()
    expect((await getStatsData()).hourly[key]).toMatchObject({ input_tokens: 33, output_tokens: 4, request_count: 1 })
  })

  it('deleteBefore：statsMaxDays=90 删除 100 天前桶，保留 10 天前桶', async () => {
    const oldKey = shiftedKey(100)
    const recentKey = shiftedKey(10)
    insertStatsBucket({ key: oldKey, inputTokens: 100 })
    insertStatsBucket({ key: recentKey, inputTokens: 10 })

    await aggregateStats(undefined, 90)
    const db = getDatabase()
    expect(db.prepare('SELECT * FROM stats WHERE period_key = ?').get(oldKey)).toBeUndefined()
    expect(db.prepare('SELECT * FROM stats WHERE period_key = ?').get(recentKey)).toBeTruthy()
  })

  it('statsMaxDays=0：旧桶永久保留', async () => {
    const oldKey = shiftedKey(100)
    insertStatsBucket({ key: oldKey, inputTokens: 100 })

    await aggregateStats(undefined, 0)
    expect(getDatabase().prepare('SELECT * FROM stats WHERE period_key = ?').get(oldKey)).toBeTruthy()
  })

  it('closed_at 非空的中断行仍计入账本与 getTodayStats', async () => {
    const ts = new Date().toISOString()
    insertRequest({
      timestamp: ts,
      inputTokens: 100,
      outputTokens: 50,
      cacheReadTokens: 10,
      closedAt: new Date().toISOString(),
      model: 'claude-interrupted'
    })

    await aggregateStats()
    const entry = (await getStatsData()).hourly[hourKeyOf(ts)]
    expect(entry).toMatchObject({ input_tokens: 100, output_tokens: 50, cache_read_tokens: 10, request_count: 1 })

    const since = new Date(Date.now() - 3600000).toISOString()
    const today = await getTodayStats(since)
    expect(today.input_tokens).toBe(100)
    expect(today.output_tokens).toBe(50)
    expect(today.request_count).toBe(1)
    expect(today.models['claude-interrupted']).toBe(1)
  })
})

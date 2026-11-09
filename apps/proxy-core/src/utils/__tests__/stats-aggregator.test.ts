import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import path from 'path'
import { configureDbPath, initDatabase, closeDatabase, getDatabase } from '../db.js'
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

function hourKeyOf(iso: string): string {
  const d = new Date(iso)
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}-${String(d.getUTCHours()).padStart(2, '0')}`
}

describe('stats-aggregator', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = mkdtempSync(path.join(tmpdir(), 'ccm-stats-'))
    configureDbPath(path.join(tempDir, 'test.db'))
    initDatabase()
  })

  afterEach(() => {
    closeDatabase()
    rmSync(tempDir, { recursive: true, force: true })
  })

  it('P0: requests 源行删除后重算，冻结的 hourly 快照同步消失', () => {
    const ts = new Date(Date.now() - 2 * 3600000).toISOString()
    const key = hourKeyOf(ts)
    insertRequest({ timestamp: ts, inputTokens: 100, outputTokens: 20 })

    aggregateStats()
    let stats = getStatsData()
    expect(stats.hourly[key]).toBeTruthy()
    expect(stats.hourly[key].input_tokens).toBe(100)
    expect(stats.hourly[key].request_count).toBe(1)

    // 模拟 cleanOldRequestsDB 把源行删掉
    getDatabase().prepare('DELETE FROM requests').run()

    aggregateStats()
    stats = getStatsData()
    expect(stats.hourly[key]).toBeUndefined()
  })

  it('P2: closed_at 非空的中断行仍计入 aggregateStats 与 getTodayStats', () => {
    const ts = new Date().toISOString()
    const key = hourKeyOf(ts)
    insertRequest({
      timestamp: ts,
      inputTokens: 100,
      outputTokens: 50,
      cacheReadTokens: 10,
      cacheCreationTokens: 3,
      closedAt: new Date().toISOString(),
      model: 'claude-interrupted'
    })

    aggregateStats()
    const entry = getStatsData().hourly[key]
    expect(entry).toBeTruthy()
    expect(entry.input_tokens).toBe(100)
    expect(entry.output_tokens).toBe(50)
    expect(entry.cache_read_tokens).toBe(10)
    expect(entry.cache_creation_tokens).toBe(3)
    expect(entry.request_count).toBe(1)

    const since = new Date(Date.now() - 3600000).toISOString()
    const today = getTodayStats(since)
    expect(today.input_tokens).toBe(100)
    expect(today.output_tokens).toBe(50)
    expect(today.cache_read_tokens).toBe(10)
    expect(today.request_count).toBe(1)
    expect(today.models['claude-interrupted']).toBe(1)
  })

  it('P1: aggregateStats(1) 只保留 1 天窗口，无参仍为 30 天窗口', () => {
    const nowIso = new Date().toISOString()
    const oldIso = new Date(Date.now() - 2 * 86400000).toISOString()
    const nowKey = hourKeyOf(nowIso)
    const oldKey = hourKeyOf(oldIso)
    insertRequest({ timestamp: nowIso, inputTokens: 1 })
    insertRequest({ timestamp: oldIso, inputTokens: 2 })

    aggregateStats(1)
    let stats = getStatsData()
    expect(stats.hourly[nowKey]).toBeTruthy()
    expect(stats.hourly[oldKey]).toBeUndefined()

    aggregateStats()
    stats = getStatsData()
    expect(stats.hourly[nowKey]).toBeTruthy()
    expect(stats.hourly[oldKey]).toBeTruthy()
  })

  describe('P1b: aggregateStats 的 windowDays 分支（截断与回退）', () => {
    // 31 天前落在 30 天窗口外、40 天窗口内：保留它意味着窗口被放宽到 40，
    // 删除它才是「截断/回退为 30」；2 天前始终在窗口内。
    it.each([
      [40, '超过 30 截断为 30'],
      [0, '0 回退默认 30'],
      [-3, '负数回退默认 30'],
      [1.5, '非整数回退默认 30']
    ])('maxDays = %s（%s）：2 天前保留，31 天前删除', (maxDays, _desc) => {
      const recentIso = new Date(Date.now() - 2 * 86400000).toISOString()
      const oldIso = new Date(Date.now() - 31 * 86400000).toISOString()
      const recentKey = hourKeyOf(recentIso)
      const oldKey = hourKeyOf(oldIso)
      insertRequest({ timestamp: recentIso, inputTokens: 2 })
      insertRequest({ timestamp: oldIso, inputTokens: 31 })

      aggregateStats(maxDays)
      const stats = getStatsData()
      expect(stats.hourly[recentKey]).toBeTruthy()
      expect(stats.hourly[oldKey]).toBeUndefined()
    })
  })
})

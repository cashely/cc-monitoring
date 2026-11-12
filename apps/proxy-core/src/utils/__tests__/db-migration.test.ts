import Database from 'better-sqlite3'
import { applySchemaV2, applySchemaV3, applySchemaV9, applySchemaV12, applySchemaV13, applySchemaV14 } from '../db.js'

describe('Schema Migration V2', () => {
  let db: Database.Database

  beforeEach(() => {
    db = new Database(':memory:')
    db.pragma('journal_mode = WAL')
    db.exec(`
      CREATE TABLE IF NOT EXISTS schema_version (
        version INTEGER PRIMARY KEY
      )
    `)
  })

  afterEach(() => {
    db.close()
  })

  test('initDatabase creates providers table with correct schema', () => {
    applySchemaV2(db)

    const columns = db.prepare(
      "PRAGMA table_info(providers)"
    ).all() as { name: string; type: string; notnull: number; pk: number }[]

    const colNames = columns.map(c => c.name)
    expect(colNames).toContain('id')
    expect(colNames).toContain('name')
    expect(colNames).toContain('base_url')
    expect(colNames).toContain('api_key')
    expect(colNames).toContain('model')
    expect(colNames).toContain('haiku_model')
    expect(colNames).toContain('sonnet_model')
    expect(colNames).toContain('opus_model')
    expect(colNames).toContain('subagent_model')
    expect(colNames).toContain('provider')
    expect(colNames).toContain('created_at')
    expect(colNames).toContain('updated_at')

    // Verify id is primary key
    const idCol = columns.find(c => c.name === 'id')
    expect(idCol?.pk).toBe(1)

    // Verify name is NOT NULL and UNIQUE
    const nameCol = columns.find(c => c.name === 'name')
    expect(nameCol?.notnull).toBe(1)
  })

  test('providers table has UNIQUE index on name', () => {
    applySchemaV2(db)

    const indexes = db.prepare(
      "PRAGMA index_list(providers)"
    ).all() as { name: string; unique: number }[]

    const nameIdx = indexes.find(i => i.name === 'idx_providers_name')
    expect(nameIdx).toBeDefined()
    expect(nameIdx?.unique).toBe(1)

    // Verify uniqueness constraint works
    db.prepare(
      "INSERT INTO providers (name, base_url, api_key, model, provider) VALUES (?, ?, ?, ?, ?)"
    ).run('test-provider', 'https://api.test.com', 'key1', 'claude-3', 'anthropic')

    // Duplicate name should fail
    expect(() => {
      db.prepare(
        "INSERT INTO providers (name, base_url, api_key, model, provider) VALUES (?, ?, ?, ?, ?)"
      ).run('test-provider', 'https://other.test.com', 'key2', 'gpt-4', 'openai')
    }).toThrow()
  })

  test('migration runs only once (schema_version = 2)', () => {
    applySchemaV2(db)
    db.prepare('INSERT OR REPLACE INTO schema_version (version) VALUES (2)').run()

    // Running migration again should not error (IF NOT EXISTS)
    applySchemaV2(db)

    // schema_version should still be 2
    const row = db.prepare('SELECT version FROM schema_version WHERE version = 2').get() as { version: number } | undefined
    expect(row?.version).toBe(2)

    // Table should still have exactly the same columns (no duplication)
    const columns = db.prepare("PRAGMA table_info(providers)").all()
    expect(columns.length).toBe(12) // id + 9 fields + created_at + updated_at
  })

  test('applySchemaV3 adds is_default column to providers', () => {
    applySchemaV2(db)
    applySchemaV3(db)

    const columns = db.prepare("PRAGMA table_info(providers)").all() as { name: string }[]
    const colNames = columns.map(c => c.name)
    expect(colNames).toContain('is_default')

    // Default value should be 0 (false)
    const row = db.prepare("SELECT is_default FROM providers LIMIT 1").all()
    expect(row.length).toBe(0) // no rows yet, but column exists
  })

  test('applySchemaV3 is idempotent', () => {
    applySchemaV2(db)
    applySchemaV3(db)
    // Second call should not throw
    expect(() => applySchemaV3(db)).not.toThrow()

    const columns = db.prepare("PRAGMA table_info(providers)").all()
    const isDefaultCols = columns.filter((c: any) => c.name === 'is_default')
    expect(isDefaultCols.length).toBe(1)
  })

  test('applySchemaV9 adds auth_style column with default bearer', () => {
    applySchemaV2(db)
    applySchemaV9(db)

    const columns = db.prepare("PRAGMA table_info(providers)").all() as { name: string }[]
    expect(columns.map(c => c.name)).toContain('auth_style')

    // Existing rows get the default 'bearer'
    db.prepare("INSERT INTO providers (name, base_url, api_key, model, provider) VALUES (?, ?, ?, ?, ?)").run(
      'p1', 'https://api.test.com', 'key1', 'claude-3', 'anthropic'
    )
    const row = db.prepare("SELECT auth_style FROM providers WHERE name = 'p1'").get() as { auth_style: string }
    expect(row.auth_style).toBe('bearer')
  })

  test('applySchemaV9 is idempotent', () => {
    applySchemaV2(db)
    applySchemaV9(db)
    expect(() => applySchemaV9(db)).not.toThrow()

    const columns = db.prepare("PRAGMA table_info(providers)").all() as { name: string }[]
    const authStyleCols = columns.filter(c => c.name === 'auth_style')
    expect(authStyleCols.length).toBe(1)
  })
})

describe('Schema Migration V12', () => {
  let db: Database.Database

  beforeEach(() => {
    db = new Database(':memory:')
    // 最小化构造 V12 所需的两张表（与生产列名一致）
    db.exec(`
      CREATE TABLE requests (request_id TEXT PRIMARY KEY)
    `)
    db.exec(`
      CREATE TABLE response_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        request_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        event_index INTEGER NOT NULL,
        event_type TEXT,
        event_data TEXT NOT NULL
      )
    `)
    db.exec(`
      CREATE INDEX idx_response_events_request
      ON response_events(request_id, session_id, event_index)
    `)
  })

  afterEach(() => {
    db.close()
  })

  test('dedups repeated triples keeping MIN(id), deletes orphan events, creates unique index', () => {
    db.prepare('INSERT INTO requests (request_id) VALUES (?)').run('req-ok')

    const ins = db.prepare(
      'INSERT INTO response_events (request_id, session_id, event_index, event_data) VALUES (?, ?, ?, ?)'
    )
    // 三元组 (req-ok, sess-a, 0) 重复 3 行 → id 1,2,3
    ins.run('req-ok', 'sess-a', 0, 'a1')
    ins.run('req-ok', 'sess-a', 0, 'a2')
    ins.run('req-ok', 'sess-a', 0, 'a3')
    // 三元组 (req-ok, sess-a, 1) 重复 2 行 → id 4,5
    ins.run('req-ok', 'sess-a', 1, 'b1')
    ins.run('req-ok', 'sess-a', 1, 'b2')
    // 不重复组 → id 6
    ins.run('req-ok', 'sess-a', 2, 'c')
    // 孤儿事件（requests 无 req-gone）→ id 7,8
    ins.run('req-gone', 'sess-a', 0, 'o1')
    ins.run('req-gone', 'sess-a', 0, 'o2')

    applySchemaV12(db)

    // 不存在任何重复三元组
    const dupGroups = db.prepare(`
      SELECT COUNT(*) AS c FROM (
        SELECT 1 FROM response_events
        GROUP BY request_id, session_id, event_index
        HAVING COUNT(*) > 1
      )
    `).get() as { c: number }
    expect(dupGroups.c).toBe(0)

    // 只剩三元组 A、B、c 各一行，孤儿删光
    expect(
      (db.prepare('SELECT COUNT(*) AS c FROM response_events').get() as { c: number }).c
    ).toBe(3)
    expect(
      (db.prepare("SELECT COUNT(*) AS c FROM response_events WHERE request_id = 'req-gone'").get() as { c: number }).c
    ).toBe(0)

    // 每组保留 MIN(id)
    const ids = (db.prepare('SELECT id FROM response_events ORDER BY id').all() as { id: number }[])
      .map(r => r.id)
    expect(ids).toEqual([1, 4, 6])

    // 唯一索引存在
    const indexes = db.prepare('PRAGMA index_list(response_events)').all() as { name: string; unique: number }[]
    const uq = indexes.find(i => i.name === 'uq_response_events')
    expect(uq).toBeTruthy()
    expect(uq?.unique).toBe(1)

    // 唯一约束硬守：再插同三元组必须报错
    expect(() => ins.run('req-ok', 'sess-a', 0, 'dup')).toThrow()
  })

  test('applySchemaV12 is idempotent', () => {
    db.prepare('INSERT INTO requests (request_id) VALUES (?)').run('req-ok')
    db.prepare(
      'INSERT INTO response_events (request_id, session_id, event_index, event_data) VALUES (?, ?, ?, ?)'
    ).run('req-ok', 'sess-a', 0, 'a')

    applySchemaV12(db)
    // 再跑一次不报错，行数与唯一索引状态保持
    expect(() => applySchemaV12(db)).not.toThrow()
    expect(
      (db.prepare('SELECT COUNT(*) AS c FROM response_events').get() as { c: number }).c
    ).toBe(1)

    const indexes = db.prepare('PRAGMA index_list(response_events)').all() as { name: string }[]
    const uqIndexes = indexes.filter(i => i.name === 'uq_response_events')
    expect(uqIndexes).toHaveLength(1)
  })
})

describe('Schema Migration V13', () => {
  let db: Database.Database

  beforeEach(() => {
    db = new Database(':memory:')
    // 最小化构造 V13 索引所需的 requests 表（与生产列名一致）
    db.exec(`
      CREATE TABLE requests (
        request_id TEXT PRIMARY KEY,
        timestamp TEXT NOT NULL,
        completed_at TEXT,
        closed_at TEXT
      )
    `)
  })

  afterEach(() => {
    db.close()
  })

  test('creates partial index idx_requests_recover on timestamp', () => {
    applySchemaV13(db)

    const indexes = db.prepare('PRAGMA index_list(requests)').all() as { name: string }[]
    const idx = indexes.find(i => i.name === 'idx_requests_recover')
    expect(idx).toBeTruthy()

    // 索引键列为 timestamp
    const cols = db.prepare('PRAGMA index_info(idx_requests_recover)').all() as { name: string }[]
    expect(cols.map(c => c.name)).toEqual(['timestamp'])

    // partial 谓词与定义一致
    const row = db.prepare(
      "SELECT sql FROM sqlite_master WHERE type = 'index' AND name = 'idx_requests_recover'"
    ).get() as { sql: string }
    expect(row.sql).toContain('WHERE completed_at IS NULL AND closed_at IS NULL')
  })

  test('applySchemaV13 is idempotent', () => {
    applySchemaV13(db)
    expect(() => applySchemaV13(db)).not.toThrow()

    const indexes = db.prepare('PRAGMA index_list(requests)').all() as { name: string }[]
    expect(indexes.filter(i => i.name === 'idx_requests_recover')).toHaveLength(1)
  })
})

describe('Schema Migration V14', () => {
  let db: Database.Database

  beforeEach(() => {
    db = new Database(':memory:')
    // 最小化构造 V14 回填所需的 requests / stats 表（与生产列名一致）
    db.exec(`
      CREATE TABLE requests (
        request_id TEXT PRIMARY KEY,
        timestamp TEXT NOT NULL,
        input_tokens INTEGER,
        output_tokens INTEGER,
        cache_read_tokens INTEGER,
        cache_creation_tokens INTEGER
      )
    `)
    db.exec(`
      CREATE TABLE stats (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        period TEXT NOT NULL,
        period_key TEXT NOT NULL,
        input_tokens INTEGER DEFAULT 0,
        output_tokens INTEGER DEFAULT 0,
        cache_read_tokens INTEGER DEFAULT 0,
        cache_creation_tokens INTEGER DEFAULT 0,
        request_count INTEGER DEFAULT 0,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(period, period_key)
      )
    `)
  })

  afterEach(() => {
    db.close()
  })

  test('backfills hourly stats buckets from requests across two UTC hours', () => {
    const ins = db.prepare(`
      INSERT INTO requests (request_id, timestamp, input_tokens, output_tokens,
        cache_read_tokens, cache_creation_tokens)
      VALUES (?, ?, ?, ?, ?, ?)
    `)
    // Hour 10: two rows (UTC, parsed by strftime)
    ins.run('r1', '2024-01-01T10:15:00', 100, 50, 10, 2)
    ins.run('r2', '2024-01-01T10:45:00', 200, 70, 20, 4)
    // Hour 11: one row
    ins.run('r3', '2024-01-01T11:05:00', 50, 25, 5, 1)

    applySchemaV14(db)

    const rows = db.prepare(`
      SELECT period, period_key, input_tokens, output_tokens, cache_read_tokens,
        cache_creation_tokens, request_count
      FROM stats ORDER BY period_key ASC
    `).all() as {
      period: string
      period_key: string
      input_tokens: number
      output_tokens: number
      cache_read_tokens: number
      cache_creation_tokens: number
      request_count: number
    }[]

    expect(rows).toHaveLength(2)

    expect(rows[0]).toMatchObject({
      period: 'hourly',
      period_key: '2024-01-01-10',
      input_tokens: 300,
      output_tokens: 120,
      cache_read_tokens: 30,
      cache_creation_tokens: 6,
      request_count: 2
    })
    expect(rows[1]).toMatchObject({
      period: 'hourly',
      period_key: '2024-01-01-11',
      input_tokens: 50,
      output_tokens: 25,
      cache_read_tokens: 5,
      cache_creation_tokens: 1,
      request_count: 1
    })
  })

  test('applySchemaV14 is idempotent — re-running does not duplicate or change rows', () => {
    const ins = db.prepare(`
      INSERT INTO requests (request_id, timestamp, input_tokens, output_tokens,
        cache_read_tokens, cache_creation_tokens)
      VALUES (?, ?, ?, ?, ?, ?)
    `)
    ins.run('r1', '2024-01-01T10:15:00', 100, 50, 10, 2)
    ins.run('r2', '2024-01-01T11:05:00', 50, 25, 5, 1)

    applySchemaV14(db)
    applySchemaV14(db)

    // Still exactly two buckets, values unchanged
    const rows = db.prepare(`
      SELECT period_key, input_tokens, output_tokens, request_count
      FROM stats ORDER BY period_key ASC
    `).all() as { period_key: string; input_tokens: number; output_tokens: number; request_count: number }[]
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ period_key: '2024-01-01-10', input_tokens: 100, output_tokens: 50, request_count: 1 })
    expect(rows[1]).toMatchObject({ period_key: '2024-01-01-11', input_tokens: 50, output_tokens: 25, request_count: 1 })
  })
})

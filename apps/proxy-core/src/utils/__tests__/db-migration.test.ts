import Database from 'better-sqlite3'
import { applySchemaV2, applySchemaV3 } from '../db.js'

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
})

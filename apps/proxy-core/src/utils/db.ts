import Database from 'better-sqlite3'
import path from 'path'
import fs from 'fs'
import { logsDir } from './paths.js'

// DB 绝对路径：由 server 启动时按 config.storage.path 设置，未设置则回退到数据目录
let dbPath: string | null = null

export function configureDbPath(absPath: string): void {
  dbPath = absPath
}

let db: Database.Database | null = null

export function initDatabase(): Database.Database {
  if (db) return db

  const resolvedPath = dbPath || path.join(logsDir, 'proxy.db')

  // Ensure database directory exists
  const dbDir = path.dirname(resolvedPath)
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true })
  }

  // Initialize SQLite database
  db = new Database(resolvedPath)

  // Enable WAL mode for better concurrency & durability
  db.pragma('journal_mode = WAL')
  db.pragma('synchronous = NORMAL')

  // Create schema_version table
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_version (
      version INTEGER PRIMARY KEY
    )
  `)

  // Check current schema version
  const versionRow = db.prepare('SELECT version FROM schema_version').get() as { version: number } | undefined
  const currentVersion = versionRow?.version || 0

  // Apply migrations if needed
  if (currentVersion < 1) {
    applySchemaV1(db)
    db.prepare('INSERT OR REPLACE INTO schema_version (version) VALUES (1)').run()
  }

  if (currentVersion < 2) {
    applySchemaV2(db)
    db.prepare('INSERT OR REPLACE INTO schema_version (version) VALUES (2)').run()
  }

  if (currentVersion < 3) {
    applySchemaV3(db)
    db.prepare('INSERT OR REPLACE INTO schema_version (version) VALUES (3)').run()
  }

  if (currentVersion < 4) {
    applySchemaV4(db)
    db.prepare('INSERT OR REPLACE INTO schema_version (version) VALUES (4)').run()
  }

  if (currentVersion < 5) {
    applySchemaV5(db)
    db.prepare('INSERT OR REPLACE INTO schema_version (version) VALUES (5)').run()
  }

  if (currentVersion < 6) {
    applySchemaV6(db)
    db.prepare('INSERT OR REPLACE INTO schema_version (version) VALUES (6)').run()
  }

  if (currentVersion < 7) {
    applySchemaV7(db)
    db.prepare('INSERT OR REPLACE INTO schema_version (version) VALUES (7)').run()
  }

  if (currentVersion < 8) {
    applySchemaV8(db)
    db.prepare('INSERT OR REPLACE INTO schema_version (version) VALUES (8)').run()
  }

  if (currentVersion < 9) {
    applySchemaV9(db)
    db.prepare('INSERT OR REPLACE INTO schema_version (version) VALUES (9)').run()
  }

  return db
}

export function applySchemaV2(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS providers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      base_url TEXT NOT NULL,
      api_key TEXT NOT NULL,
      model TEXT NOT NULL,
      haiku_model TEXT,
      sonnet_model TEXT,
      opus_model TEXT,
      subagent_model TEXT,
      provider TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `)
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_providers_name ON providers(name)`)
}

export function applySchemaV3(db: Database.Database) {
  // Add is_default column for provider activation feature
  // ALTER TABLE ADD COLUMN is idempotent-safe via column-existence check
  const columns = db.prepare("PRAGMA table_info(providers)").all() as { name: string }[]
  if (!columns.some(c => c.name === 'is_default')) {
    db.exec('ALTER TABLE providers ADD COLUMN is_default INTEGER NOT NULL DEFAULT 0')
  }
}

export function applySchemaV4(db: Database.Database) {
  // Remove NOT NULL constraints from base_url, api_key, model
  // SQLite doesn't support ALTER COLUMN, so rebuild the table
  const columns = db.prepare("PRAGMA table_info(providers)").all() as { name: string, notnull: number }[]
  const hasNotNullColumns = columns.some(c =>
    ['base_url', 'api_key', 'model'].includes(c.name) && c.notnull === 1
  )

  if (hasNotNullColumns) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS providers_new (
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
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `)
    db.exec(`
      INSERT INTO providers_new
      SELECT id, name, base_url, api_key, model, haiku_model, sonnet_model, opus_model, subagent_model, provider, is_default, created_at, updated_at
      FROM providers
    `)
    db.exec('DROP TABLE providers')
    db.exec('ALTER TABLE providers_new RENAME TO providers')
    db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_providers_name ON providers(name)')
  }
}

function applySchemaV1(db: Database.Database) {
  // Main requests table
  db.exec(`
    CREATE TABLE IF NOT EXISTS requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      request_id TEXT UNIQUE NOT NULL,
      session_id TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      method TEXT NOT NULL,
      path TEXT NOT NULL,
      status_code INTEGER NOT NULL,
      response_time INTEGER NOT NULL,
      api_key TEXT,
      proxy_api_key TEXT,
      base_url TEXT,
      model TEXT,
      input_tokens INTEGER,
      output_tokens INTEGER,
      cache_read_tokens INTEGER,
      cache_creation_tokens INTEGER,
      request_headers TEXT,
      request_body TEXT,
      response_headers TEXT,
      response_events TEXT,
      completed_at TEXT,
      closed_at TEXT,
      error TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `)

  // Create indexes
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_requests_session ON requests(session_id, timestamp DESC)
  `)
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_requests_time ON requests(timestamp DESC)
  `)
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_requests_status ON requests(status_code)
  `)
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_requests_path ON requests(path)
  `)
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_requests_api_key ON requests(api_key)
  `)
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_requests_proxy_api_key ON requests(proxy_api_key)
  `)
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_requests_base_url ON requests(base_url)
  `)
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_requests_model ON requests(model)
  `)

  // Stats aggregation table
  db.exec(`
    CREATE TABLE IF NOT EXISTS stats (
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

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_stats_period ON stats(period, period_key)
  `)
}

export function applySchemaV5(db: Database.Database) {
  // Add machine_id column to requests table
  const columns = db.prepare("PRAGMA table_info(requests)").all() as { name: string }[]
  if (!columns.some(c => c.name === 'machine_id')) {
    db.exec('ALTER TABLE requests ADD COLUMN machine_id TEXT')
  }
  // Create index for machine_id
  db.exec(`CREATE INDEX IF NOT EXISTS idx_requests_machine_id ON requests(machine_id)`)
}

export function applySchemaV6(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS mcp_servers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      transport_type TEXT NOT NULL CHECK(transport_type IN ('stdio', 'sse', 'streamable-http')),
      command TEXT,
      args TEXT,
      env TEXT,
      url TEXT,
      headers TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `)
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_mcp_servers_name ON mcp_servers(name)')
}

export function applySchemaV7(db: Database.Database) {
  // Add is_openai_compatible column for OpenAI format conversion toggle
  const columns = db.prepare("PRAGMA table_info(providers)").all() as { name: string }[]
  if (!columns.some(c => c.name === 'is_openai_compatible')) {
    db.exec('ALTER TABLE providers ADD COLUMN is_openai_compatible INTEGER NOT NULL DEFAULT 0')
  }
}

export function applySchemaV8(db: Database.Database) {
  // Separate table for streaming SSE events — eliminates in-memory accumulation
  db.exec(`
    CREATE TABLE IF NOT EXISTS response_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      request_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      event_index INTEGER NOT NULL,
      event_type TEXT,
      event_data TEXT NOT NULL
    )
  `)
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_response_events_request
    ON response_events(request_id, session_id, event_index)
  `)
}

export function applySchemaV9(db: Database.Database) {
  // Add auth_style column for per-provider auth header normalization
  const columns = db.prepare("PRAGMA table_info(providers)").all() as { name: string }[]
  if (!columns.some(c => c.name === 'auth_style')) {
    db.exec("ALTER TABLE providers ADD COLUMN auth_style TEXT NOT NULL DEFAULT 'bearer'")
  }
}

export function closeDatabase() {
  if (db) {
    db.close()
    db = null
  }
}

export function getDatabase(): Database.Database {
  if (!db) {
    throw new Error('Database not initialized. Call initDatabase() first.')
  }
  return db
}
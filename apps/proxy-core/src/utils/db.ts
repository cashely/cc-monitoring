import Database from 'better-sqlite3'
import path from 'path'
import fs from 'fs'

const DB_PATH = 'logs/proxy.db'

let db: Database.Database | null = null

export function initDatabase(): Database.Database {
  if (db) return db

  // Ensure logs directory exists
  const logsDir = path.dirname(DB_PATH)
  if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true })
  }

  // Initialize SQLite database
  db = new Database(DB_PATH)

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
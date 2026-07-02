import Database from 'better-sqlite3'
import * as fs from 'fs'
import * as path from 'path'

const REQUESTS_DIR = path.resolve('../../logs/requests') // Relative to packages/core
const DB_PATH = path.resolve('../../logs/proxy.db')      // Use root directory database

// Extract token usage from events (same logic as request-writer.ts)
function extractTokenUsage(events: any[] | undefined): {
  input_tokens?: number
  output_tokens?: number
  cache_read_input_tokens?: number
  cache_creation_input_tokens?: number
} | undefined {
  if (!events) return undefined
  const messageDelta = events.find((e: any) => e?.type === 'message_delta')
  return messageDelta?.usage
}

// Extract API key from headers
function extractApiKey(headers: Record<string, string>): string | undefined {
  const auth = headers['authorization'] || headers['Authorization']
  if (!auth) return undefined

  // Extract Bearer token
  if (auth.startsWith('Bearer ')) {
    return auth.slice(7)
  }
  return auth
}

// Migrate all historical files to SQLite
export async function migrateFilesToDatabase(): Promise<void> {
  // Use root directory database directly (not packages/core/logs/proxy.db)
  const db = Database(DB_PATH)

  console.log('Starting migration from files to SQLite...')
  console.log('Database path:', DB_PATH)

  // Get all session directories
  const sessionDirs = fs.readdirSync(REQUESTS_DIR)
  let totalFiles = 0
  let successCount = 0
  let errorCount = 0

  const insertStmt = db.prepare(`
    INSERT OR IGNORE INTO requests (
      request_id, session_id, timestamp, method, path, status_code, response_time,
      api_key, proxy_api_key, base_url, model,
      input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens,
      request_headers, request_body, response_headers, response_events,
      completed_at, closed_at, error
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
    )
  `)

  const transaction = db.transaction((requests: any[]) => {
    for (const req of requests) {
      try {
        insertStmt.run(...req)
        successCount++
      } catch (err) {
        errorCount++
        console.error(`Failed to insert ${req[0]}: ${err}`)
      }
    }
  })

  const allRequests: any[] = []

  for (const sessionId of sessionDirs) {
    const sessionPath = path.join(REQUESTS_DIR, sessionId)
    const sessionStat = fs.statSync(sessionPath)

    if (!sessionStat.isDirectory()) continue

    const files = fs.readdirSync(sessionPath)

    for (const file of files) {
      if (!file.startsWith('req-') || !file.endsWith('.json')) continue

      totalFiles++
      const filePath = path.join(sessionPath, file)

      try {
        const content = fs.readFileSync(filePath, 'utf-8')
        const data = JSON.parse(content)

        // Extract requestId from filename
        const requestId = file.slice(4, -5)

        // Extract fields
        const usage = extractTokenUsage(data.response?.events)
        const apiKey = extractApiKey(data.request?.headers || {})
        const model = data.request?.body?.model

        // Calculate response time
        const responseTime = data.response?.completedAt && data.timestamp
          ? Math.round((new Date(data.response.completedAt).getTime() - new Date(data.timestamp).getTime()))
          : 0

        // Prepare insert data (22 fields)
        const insertData = [
          requestId,                              // request_id
          sessionId,                              // session_id
          data.timestamp,                         // timestamp
          data.request?.method || 'POST',         // method
          data.request?.path || '',               // path
          data.response?.statusCode || 0,         // status_code
          responseTime,                           // response_time
          apiKey || null,                         // api_key
          null,                                   // proxy_api_key (unknown in files)
          null,                                   // base_url (unknown in files)
          model || null,                          // model
          usage?.input_tokens || null,            // input_tokens
          usage?.output_tokens || null,           // output_tokens
          usage?.cache_read_input_tokens || null,  // cache_read_tokens (correct field name)
          usage?.cache_creation_input_tokens || null, // cache_creation_tokens (correct field name)
          data.request?.headers ? JSON.stringify(data.request.headers) : null, // request_headers
          data.request?.body ? JSON.stringify(data.request.body) : null,       // request_body
          data.response?.headers ? JSON.stringify(data.response.headers) : null, // response_headers
          data.response?.events ? JSON.stringify(data.response.events) : null, // response_events
          data.response?.completedAt || null,     // completed_at
          data.response?.closedAt || null,        // closed_at
          data.response?.error || null            // error
        ]

        allRequests.push(insertData)

        if (totalFiles % 100 === 0) {
          console.log(`Processed ${totalFiles} files...`)
        }
      } catch (err) {
        errorCount++
        console.error(`Failed to parse ${filePath}: ${err}`)
      }
    }
  }

  // Batch insert in transaction
  console.log(`Inserting ${allRequests.length} records into database...`)
  transaction(allRequests)

  console.log(`Migration completed:`)
  console.log(`  Total files: ${totalFiles}`)
  console.log(`  Success: ${successCount}`)
  console.log(`  Errors: ${errorCount}`)
  console.log(`  Database: logs/proxy.db`)
}

// Run migration if executed directly (using ES module entry point check)
// Note: This script should be run via: node dist/utils/migrate-files-to-db.js
migrateFilesToDatabase()
  .then(() => {
    console.log('Migration finished')
    process.exit(0)
  })
  .catch((err) => {
    console.error('Migration failed:', err)
    process.exit(1)
  })
import Database from 'better-sqlite3'

export type TransportType = 'stdio' | 'sse' | 'streamable-http'

export interface McpServer {
  id: number
  name: string
  transport_type: TransportType
  command: string | null
  args: string | null       // JSON array string, e.g. '["--port", "3000"]'
  env: string | null        // JSON object string, e.g. '{"KEY": "val"}'
  url: string | null
  headers: string | null    // JSON object string for auth headers
  enabled: boolean
  created_at: string
  updated_at: string
}

export interface McpServerInput {
  name: string
  transport_type: TransportType
  command?: string
  args?: string[]
  env?: Record<string, string>
  url?: string
  headers?: Record<string, string>
  enabled?: boolean
}

export interface McpServerError {
  field: string
  message: string
}

export function listMcpServers(db: Database.Database): McpServer[] {
  const rows = db.prepare('SELECT * FROM mcp_servers ORDER BY created_at DESC')
    .all() as (Omit<McpServer, 'enabled'> & { enabled: number })[]
  return rows.map(r => ({ ...r, enabled: !!r.enabled }))
}

export function getMcpServer(db: Database.Database, id: number): McpServer | undefined {
  const row = db.prepare('SELECT * FROM mcp_servers WHERE id = ?').get(id) as (Omit<McpServer, 'enabled'> & { enabled: number }) | undefined
  return row ? { ...row, enabled: !!row.enabled } : undefined
}

export function createMcpServer(db: Database.Database, input: McpServerInput): McpServer {
  const errors = validateMcpServerInput(input)
  if (errors.length) throw new Error(errors.map(e => `${e.field}: ${e.message}`).join('; '))

  const insert = db.prepare(`
    INSERT INTO mcp_servers (name, transport_type, command, args, env, url, headers, enabled)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `)
  insert.run(
    input.name,
    input.transport_type,
    input.command || null,
    input.args ? JSON.stringify(input.args) : null,
    input.env ? JSON.stringify(input.env) : null,
    input.url || null,
    input.headers ? JSON.stringify(input.headers) : null,
    input.enabled !== false ? 1 : 0
  )

  const row = db.prepare('SELECT * FROM mcp_servers WHERE name = ?').get(input.name) as (Omit<McpServer, 'enabled'> & { enabled: number })
  return { ...row, enabled: !!row.enabled }
}

export function updateMcpServer(db: Database.Database, id: number, input: Partial<McpServerInput>): McpServer | undefined {
  const existing = getMcpServer(db, id)
  if (!existing) return undefined

  const merged: McpServerInput = {
    name: input.name ?? existing.name,
    transport_type: input.transport_type ?? existing.transport_type,
    command: input.command ?? existing.command ?? undefined,
    args: input.args ?? (existing.args ? JSON.parse(existing.args) : undefined),
    env: input.env ?? (existing.env ? JSON.parse(existing.env) : undefined),
    url: input.url ?? existing.url ?? undefined,
    headers: input.headers ?? (existing.headers ? JSON.parse(existing.headers) : undefined),
    enabled: input.enabled ?? existing.enabled
  }

  const errors = validateMcpServerInput(merged)
  if (errors.length) throw new Error(errors.map(e => `${e.field}: ${e.message}`).join('; '))

  db.prepare(`
    UPDATE mcp_servers SET name=?, transport_type=?, command=?, args=?, env=?, url=?, headers=?, enabled=?, updated_at=CURRENT_TIMESTAMP
    WHERE id=?
  `).run(
    merged.name,
    merged.transport_type,
    merged.command || null,
    merged.args ? JSON.stringify(merged.args) : null,
    merged.env ? JSON.stringify(merged.env) : null,
    merged.url || null,
    merged.headers ? JSON.stringify(merged.headers) : null,
    merged.enabled !== false ? 1 : 0,
    id
  )

  return getMcpServer(db, id)
}

export function deleteMcpServer(db: Database.Database, id: number): boolean {
  const result = db.prepare('DELETE FROM mcp_servers WHERE id = ?').run(id)
  return result.changes > 0
}

export function validateMcpServerInput(input: McpServerInput): McpServerError[] {
  const errors: McpServerError[] = []

  if (!input.name || input.name.trim() === '') {
    errors.push({ field: 'name', message: 'name is required' })
  }

  const validTypes: TransportType[] = ['stdio', 'sse', 'streamable-http']
  if (!validTypes.includes(input.transport_type)) {
    errors.push({ field: 'transport_type', message: `must be one of: ${validTypes.join(',')}` })
  }

  // Transport-specific validation
  if (input.transport_type === 'stdio') {
    if (!input.command || input.command.trim() === '') {
      errors.push({ field: 'command', message: 'command is required for stdio transport' })
    }
  } else {
    // HTTP-based transport (sse / streamable-http)
    if (!input.url || input.url.trim() === '') {
      errors.push({ field: 'url', message: 'url is required for HTTP transport' })
    }
    if (input.url) {
      try {
        new URL(input.url)
      } catch {
        errors.push({ field: 'url', message: 'url must be a valid URL' })
      }
    }
  }

  return errors
}

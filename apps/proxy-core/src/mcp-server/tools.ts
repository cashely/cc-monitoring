import fs from 'fs'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import type { AppConfig } from '../config/schema.js'
import { getDatabase } from '../utils/db.js'
import { listRequestDB } from '../utils/request-writer.js'
import { listProviders } from '../utils/providers-db.js'

export interface McpToolContext {
  config: AppConfig
}

type ToolHandler = (args: any, ctx: McpToolContext) => Promise<any>

function ok(text: string) {
  return { content: [{ type: 'text', text }] }
}

function err(e: unknown) {
  const msg = e instanceof Error ? e.message : String(e)
  return { content: [{ type: 'text', text: `error: ${msg}` }] }
}

// --- Tool implementations ---

async function handleGetStatus(_args: any, ctx: McpToolContext) {
  const db = getDatabase()
  const lastRow = db.prepare('SELECT MAX(timestamp) AS ts FROM requests').get() as { ts: string | null }
  const countRow = db.prepare('SELECT COUNT(*) AS n FROM requests').get() as { n: number }

  let defaultProvider = null
  try {
    const providers = listProviders(db)
    const def = providers.find(p => p.default)
    if (def) {
      defaultProvider = { name: def.name, model: def.model, base_url: def.base_url }
    }
  } catch {
    // providers table may not exist on a fresh DB
  }

  return ok(JSON.stringify({
    server: `${ctx.config.server.host}:${ctx.config.server.port}`,
    proxyTarget: ctx.config.proxy.target,
    defaultProvider,
    lastRequestTimestamp: lastRow.ts,
    requestCount: countRow.n,
  }, null, 2))
}

async function handleListRequests(args: any) {
  const limit = typeof args?.limit === 'number' && args.limit > 0 ? Math.min(args.limit, 200) : 20
  const before = typeof args?.before === 'string' ? args.before : undefined
  const { requests, hasMore } = await listRequestDB(limit, before)
  const slim = requests.map(r => ({
    requestId: r.requestId,
    timestamp: r.timestamp,
    path: r.path,
    statusCode: r.statusCode,
    responseTime: r.responseTime,
    model: r.model,
    usage: r.usage,
  }))
  return ok(JSON.stringify({ requests: slim, hasMore }, null, 2))
}

async function handleGetTokenStats(args: any) {
  const hours = typeof args?.since_hours === 'number' && args.since_hours > 0 ? args.since_hours : 24
  const db = getDatabase()
  const where = "timestamp >= datetime('now', ?)"
  const param = `-${hours} hours`

  const totals = db.prepare(`
    SELECT
      COUNT(*) AS count,
      COALESCE(SUM(input_tokens), 0) AS input_tokens,
      COALESCE(SUM(output_tokens), 0) AS output_tokens,
      COALESCE(SUM(cache_read_tokens), 0) AS cache_read_tokens,
      COALESCE(SUM(cache_creation_tokens), 0) AS cache_creation_tokens
    FROM requests
    WHERE ${where}
  `).get(param) as {
    count: number
    input_tokens: number
    output_tokens: number
    cache_read_tokens: number
    cache_creation_tokens: number
  }

  const byModel = db.prepare(`
    SELECT COALESCE(model, '(null)') AS model, COUNT(*) AS count
    FROM requests
    WHERE ${where}
    GROUP BY model
    ORDER BY count DESC
  `).all(param) as { model: string; count: number }[]

  return ok(JSON.stringify({
    sinceHours: hours,
    ...totals,
    byModel,
  }, null, 2))
}

async function handleGetLogs(args: any, ctx: McpToolContext) {
  const lines = typeof args?.lines === 'number' && args.lines > 0 ? Math.min(args.lines, 500) : 50
  const file = ctx.config.logging?.file
  if (!file) return ok('(no logging.file configured)')
  if (!fs.existsSync(file)) return ok(`(log file not found: ${file})`)
  const content = fs.readFileSync(file, 'utf-8')
  const all = content.split('\n')
  const tail = all.slice(-lines).join('\n')
  return ok(tail)
}

// --- Tool registry: list metadata + dispatch ---

export const MCP_TOOLS: {
  name: string
  description: string
  inputSchema: Record<string, unknown>
}[] = [
  {
    name: 'get_status',
    description: 'Get cc-monitoring status: server/proxy config, default provider, latest request timestamp, total request count.',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: 'list_requests',
    description: 'List recent proxy requests (summary view).',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Max requests to return (default 20, max 200).' },
        before: { type: 'string', description: 'ISO timestamp cursor: return requests older than this.' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'get_token_stats',
    description: 'Aggregate token usage for requests in the last N hours (sums + per-model counts).',
    inputSchema: {
      type: 'object',
      properties: {
        since_hours: { type: 'number', description: 'Lookback window in hours (default 24).' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'get_logs',
    description: 'Return the last N lines of the cc-monitoring log file.',
    inputSchema: {
      type: 'object',
      properties: {
        lines: { type: 'number', description: 'Number of trailing lines (default 50, max 500).' },
      },
      additionalProperties: false,
    },
  },
]

const HANDLERS: Record<string, ToolHandler> = {
  get_status: handleGetStatus,
  list_requests: handleListRequests,
  get_token_stats: handleGetTokenStats,
  get_logs: handleGetLogs,
}

export function registerMcpTools(server: Server, ctx: McpToolContext): void {
  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const name = req.params.name
    const handler = HANDLERS[name]
    try {
      if (!handler) return { content: [{ type: 'text', text: `unknown tool: ${name}` }] }
      return await handler(req.params.arguments ?? {}, ctx)
    } catch (e) {
      return err(e)
    }
  })
}

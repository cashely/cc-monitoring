import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import type { McpServer, TransportType } from './mcp-db.js'
import { listMcpServers } from './mcp-db.js'
import type { InjectableTool } from '../tools/types.js'
import { mcpToolToInjectable } from '../tools/mcp-bridge.js'
import { getDatabase } from './db.js'
import { loadConfig } from '../config/index.js'
import { createMcpServer } from './mcp-db.js'

interface ManagedConnection {
  client: Client
  transport: Transport
  serverId: number
  serverName: string
  status: 'connected' | 'disconnected' | 'connecting'
  tools: InjectableTool[]
  healthTimer?: ReturnType<typeof setInterval>
  reconnectTimer?: ReturnType<typeof setTimeout>
  reconnectAttempts: number
  serverConfig: McpServer  // keep config for reconnect
}

class McpManager {
  private connections: Map<number, ManagedConnection> = new Map()

  /** Init: seed config.json mcpServers into DB, then connect all enabled servers */
  async init(): Promise<void> {
    const db = getDatabase()

    // Seed config.json mcpServers into DB (skip duplicates by name)
    try {
      const config = await loadConfig()
      const cfgServers = config.mcpServers ?? []
      if (cfgServers.length > 0) {
        const existing = listMcpServers(db)
        for (const s of cfgServers) {
          if (!existing.some(e => e.name === s.name)) {
            createMcpServer(db, s)
          }
        }
      }
    } catch {
      // Config seeding is optional; ignore errors
    }

    // Connect to all enabled servers
    const servers = listMcpServers(db).filter(s => s.enabled)
    for (const server of servers) {
      await this.connectServer(server)
    }
  }

  /** Connect to one MCP server */
  private async connectServer(server: McpServer): Promise<void> {
    // Disconnect existing connection if present
    const existing = this.connections.get(server.id)
    if (existing) {
      this.clearHealthCheck(existing)
      this.clearReconnect(existing)
      try { await existing.client.close() } catch { /* ignore */ }
    }

    const transport = this.createTransport(server)
    const client = new Client({ name: 'cc-monitoring-proxy', version: '0.1.4' })

    const conn: ManagedConnection = {
      client,
      transport,
      serverId: server.id,
      serverName: server.name,
      status: 'connecting',
      tools: [],
      reconnectAttempts: 0,
      serverConfig: server
    }
    this.connections.set(server.id, conn)

    try {
      await client.connect(transport)
      conn.status = 'connected'

      // Discover tools
      const { tools } = await client.listTools()
      conn.tools = tools.map(t => mcpToolToInjectable(t, server.name, client))

      this.startHealthCheck(conn)
    } catch (err) {
      conn.status = 'disconnected'
      conn.tools = []
      console.error(`[MCP] connect failed: ${server.name} (${server.transport_type}) — ${err instanceof Error ? err.message : String(err)}`)
      this.scheduleReconnect(conn, server)
    }
  }

  /** Create transport based on server config */
  private createTransport(server: McpServer): Transport {
    if (server.transport_type === 'stdio') {
      const env = server.env
        ? { ...process.env as Record<string, string>, ...JSON.parse(server.env) }
        : process.env as Record<string, string>

      // Split command string: "npx -y foo" → command="npx", args=["-y","foo"]
      // StdioClientTransport uses spawn(command, args), command must be a single binary.
      const parts = server.command!.trim().split(/\s+/)
      const cmd = parts[0]
      const cmdArgs = parts.slice(1)
      const storedArgs = server.args ? JSON.parse(server.args) as string[] : []
      const mergedArgs = [...cmdArgs, ...storedArgs]

      return new StdioClientTransport({
        command: cmd,
        args: mergedArgs.length > 0 ? mergedArgs : undefined,
        env
      })
    }

    if (server.transport_type === 'streamable-http') {
      const opts: { url: URL; requestInit?: { headers?: Record<string, string> } } = {
        url: new URL(server.url!)
      }
      if (server.headers) {
        opts.requestInit = { headers: JSON.parse(server.headers) }
      }
      return new StreamableHTTPClientTransport(opts.url, opts.requestInit ? { requestInit: opts.requestInit } : undefined)
    }

    if (server.transport_type === 'sse') {
      return new SSEClientTransport(new URL(server.url!))
    }

    throw new Error(`Unknown transport type: ${server.transport_type}`)
  }

  /** Periodic health check via ping */
  private startHealthCheck(conn: ManagedConnection): void {
    conn.healthTimer = setInterval(async () => {
      try {
        await conn.client.ping()
      } catch {
        conn.status = 'disconnected'
        conn.tools = []
        this.clearHealthCheck(conn)
        this.scheduleReconnect(conn, conn.serverConfig)
      }
    }, 30000)
  }

  private clearHealthCheck(conn: ManagedConnection): void {
    if (conn.healthTimer) {
      clearInterval(conn.healthTimer)
      conn.healthTimer = undefined
    }
  }

  /** Reconnect with exponential backoff */
  private scheduleReconnect(conn: ManagedConnection, server: McpServer): void {
    const delay = Math.min(2 ** conn.reconnectAttempts * 1000, 30000)
    conn.reconnectAttempts++

    conn.reconnectTimer = setTimeout(async () => {
      try {
        await this.connectServer(server)
      } catch {
        // Will schedule another reconnect in connectServer
      }
    }, delay)
  }

  private clearReconnect(conn: ManagedConnection): void {
    if (conn.reconnectTimer) {
      clearTimeout(conn.reconnectTimer)
      conn.reconnectTimer = undefined
    }
  }

  /** Get all tools from connected servers */
  getMcpTools(): InjectableTool[] {
    return Array.from(this.connections.values())
      .filter(c => c.status === 'connected')
      .flatMap(c => c.tools)
  }

  /** Get all connections with status info (for API) */
  getConnectionsInfo(): Array<{ serverId: number; serverName: string; status: string; toolCount: number }> {
    return Array.from(this.connections.values()).map(c => ({
      serverId: c.serverId,
      serverName: c.serverName,
      status: c.status,
      toolCount: c.tools.length
    }))
  }

  /** Add a new server (after REST API create) */
  async addServer(server: McpServer): Promise<void> {
    if (server.enabled) {
      await this.connectServer(server)
    }
  }

  /** Remove a server (before REST API delete) */
  async removeServer(serverId: number): Promise<void> {
    const conn = this.connections.get(serverId)
    if (conn) {
      this.clearHealthCheck(conn)
      this.clearReconnect(conn)
      try { await conn.client.close() } catch { /* ignore */ }
      this.connections.delete(serverId)
    }
  }

  /** Reconnect a server (after config update) */
  async reconnectServer(serverId: number): Promise<void> {
    const db = getDatabase()
    const server = listMcpServers(db).find(s => s.id === serverId)
    if (server && server.enabled) {
      await this.connectServer(server)
    } else {
      // Server disabled — disconnect
      await this.removeServer(serverId)
    }
  }

  /** Close all connections */
  async close(): Promise<void> {
    for (const conn of this.connections.values()) {
      this.clearHealthCheck(conn)
      this.clearReconnect(conn)
      try { await conn.client.close() } catch { /* ignore */ }
    }
    this.connections.clear()
  }
}

export const mcpManager = new McpManager()

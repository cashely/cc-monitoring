import { FastifyInstance } from 'fastify'
import { getDatabase } from '../utils/db.js'
import { mcpManager } from '../utils/mcp-manager.js'
import { listMcpServers, createMcpServer, updateMcpServer, deleteMcpServer } from '../utils/mcp-db.js'
import type { McpServerInput } from '../utils/mcp-db.js'
import { checkAuth } from './auth.js'

export async function setupMcpRoutes(fastify: FastifyInstance, config: any): Promise<void> {
  /** List all configured MCP servers with connection status */
  fastify.get('/ui/api/mcp/servers', async (request, reply) => {
    try {
      const db = getDatabase()
      const servers = listMcpServers(db)
      const connInfo = new Map(mcpManager.getConnectionsInfo().map(c => [c.serverId, c]))
      const serversWithStatus = servers.map(s => ({
        ...s,
        status: connInfo.get(s.id)?.status ?? (s.enabled ? 'not_connected' : 'disabled'),
        toolCount: connInfo.get(s.id)?.toolCount ?? 0
      }))
      return { servers: serversWithStatus }
    } catch (err: any) {
      request.log.error({ err }, 'Failed to list MCP servers')
      return reply.code(500).send({
        success: false,
        error: err.message || 'Failed to list MCP servers'
      })
    }
  })

  /** Create a new MCP server config */
  fastify.post<{ Body: { server: McpServerInput } }>('/ui/api/mcp/servers', async (request, reply) => {
    if (!checkAuth(request, config)) {
      return reply.code(401).send({
        success: false,
        error: 'Unauthorized: missing or invalid Authorization header'
      })
    }

    const server = request.body?.server
    if (!server) {
      return reply.code(400).send({
        success: false,
        error: 'Request body must contain a "server" object'
      })
    }

    try {
      const db = getDatabase()
      const created = createMcpServer(db, server)
      await mcpManager.addServer(created)
      return { success: true, server: created }
    } catch (err: any) {
      request.log.error({ err }, 'Failed to create MCP server')
      return reply.code(500).send({
        success: false,
        error: err.message || 'Failed to create MCP server'
      })
    }
  })

  /** Update an MCP server config */
  fastify.patch<{ Params: { id: string }, Body: Partial<McpServerInput> }>('/ui/api/mcp/servers/:id', async (request, reply) => {
    if (!checkAuth(request, config)) {
      return reply.code(401).send({
        success: false,
        error: 'Unauthorized: missing or invalid Authorization header'
      })
    }

    const serverId = Number(request.params.id)
    if (!Number.isFinite(serverId)) {
      return reply.code(400).send({
        success: false,
        error: 'Invalid server id'
      })
    }

    try {
      const db = getDatabase()
      const updated = updateMcpServer(db, serverId, request.body)
      if (updated) {
        await mcpManager.reconnectServer(serverId)
      }
      return { success: true, server: updated }
    } catch (err: any) {
      request.log.error({ err }, 'Failed to update MCP server')
      return reply.code(500).send({
        success: false,
        error: err.message || 'Failed to update MCP server'
      })
    }
  })

  /** Delete an MCP server config */
  fastify.delete<{ Params: { id: string } }>('/ui/api/mcp/servers/:id', async (request, reply) => {
    if (!checkAuth(request, config)) {
      return reply.code(401).send({
        success: false,
        error: 'Unauthorized: missing or invalid Authorization header'
      })
    }

    const serverId = Number(request.params.id)
    if (!Number.isFinite(serverId)) {
      return reply.code(400).send({
        success: false,
        error: 'Invalid server id'
      })
    }

    try {
      const db = getDatabase()
      await mcpManager.removeServer(serverId)
      deleteMcpServer(db, serverId)
      return { success: true }
    } catch (err: any) {
      request.log.error({ err }, 'Failed to delete MCP server')
      return reply.code(500).send({
        success: false,
        error: err.message || 'Failed to delete MCP server'
      })
    }
  })

  /** List all discovered MCP tools (live from manager cache) */
  fastify.get('/ui/api/mcp/tools', async (request, reply) => {
    try {
      const tools = mcpManager.getMcpTools().map(t => ({
        name: t.name,
        description: t.description,
        input_schema: t.input_schema
      }))
      return { tools }
    } catch (err: any) {
      request.log.error({ err }, 'Failed to list MCP tools')
      return reply.code(500).send({
        success: false,
        error: err.message || 'Failed to list MCP tools'
      })
    }
  })

  /** Reconnect a specific MCP server (manual trigger) */
  fastify.post<{ Params: { id: string } }>('/ui/api/mcp/servers/:id/reconnect', async (request, reply) => {
    if (!checkAuth(request, config)) {
      return reply.code(401).send({
        success: false,
        error: 'Unauthorized: missing or invalid Authorization header'
      })
    }

    const serverId = Number(request.params.id)
    if (!Number.isFinite(serverId)) {
      return reply.code(400).send({
        success: false,
        error: 'Invalid server id'
      })
    }

    try {
      await mcpManager.reconnectServer(serverId)
      return { success: true }
    } catch (err: any) {
      request.log.error({ err }, 'Failed to reconnect MCP server')
      return reply.code(500).send({
        success: false,
        error: err.message || 'Failed to reconnect MCP server'
      })
    }
  })
}

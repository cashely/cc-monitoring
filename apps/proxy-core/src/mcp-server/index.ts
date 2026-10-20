import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import type { AppConfig } from '../config/schema.js'
import { getProjectVersion } from '../utils/version.js'
import { MCP_TOOLS, registerMcpTools } from './tools.js'

export function createMcpServer(config: AppConfig): Server {
  const server = new Server(
    { name: 'cc-monitoring', version: getProjectVersion() },
    { capabilities: { tools: {} } },
  )

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: MCP_TOOLS.map(t => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    })),
  }))

  registerMcpTools(server, { config })
  return server
}

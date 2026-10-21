import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import type { AppConfig } from '../config/schema.js'
import { getProjectVersion } from '../utils/version.js'
import { MCP_TOOLS, registerMcpTools } from './tools.js'

const MCP_INSTRUCTIONS = `This server provides a hybrid knowledge base plus cc-monitoring proxy observability tools.

BEFORE answering domain/project-specific questions, proactively search the knowledge base: call \`list_topics\` to discover topics, then \`get_topic\` to inspect chunks, then \`read_chunk\` to read chunk bodies (one chunk per call). If the topic is unknown, use \`search_chunks\` first. Do not wait for the user to explicitly ask.

Observability tools (\`get_status\`, \`list_requests\`, \`get_token_stats\`, \`get_logs\`) are for inspecting the proxy itself: request history, token usage, log tail. Use them only when the user asks about the proxy/monitoring state.`

export function createMcpServer(config: AppConfig): Server {
  const server = new Server(
    { name: 'cc-monitoring', version: getProjectVersion() },
    {
      capabilities: { tools: {} },
      instructions: MCP_INSTRUCTIONS,
    },
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

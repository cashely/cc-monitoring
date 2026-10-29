import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import type { AppConfig } from '../config/schema.js'
import { getProjectVersion } from '../utils/version.js'
import { MCP_TOOLS, registerMcpTools } from './tools.js'

const MCP_INSTRUCTIONS = `This server provides a project knowledge base and cc-monitoring proxy observability tools.

KNOWLEDGE BASE: it is the authoritative source for this project, and your own knowledge may be outdated. Before answering any question that could relate to the project or its domain, call \`query_knowledge\` with the key terms — it searches and returns matching chunk bodies in one call. Do not rely on your own knowledge first, and do not wait for the user to explicitly ask. Skip this only for purely general questions (language syntax, standard algorithms, chitchat) with no plausible connection to a project topic.

If query_knowledge returns nothing or the result is insufficient, browse with \`list_topics\` → \`get_topic\` → \`read_chunk\` (one chunk per call). Do not call \`list_topics\` again when its result is already present in this conversation.

OBSERVABILITY tools (\`get_status\`, \`list_requests\`, \`get_token_stats\`, \`get_logs\`) inspect the proxy itself — request history, token usage, logs. Use them only when the user asks about the proxy or monitoring state.`

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

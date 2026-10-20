import { runMcpServer } from '../../mcp-server/run.js'

export async function mcpCommand(): Promise<void> {
  console.error('[ccm mcp] stdio MCP server ready')
  await runMcpServer()
}

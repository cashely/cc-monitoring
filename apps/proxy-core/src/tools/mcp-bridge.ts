import type { InjectableTool, ToolInputSchema } from './types.js'
import type { Client } from '@modelcontextprotocol/sdk/client/index.js'

/**
 * Convert an MCP Tool definition to an InjectableTool.
 *
 * Name is prefixed with `mcp__<serverName>__` to avoid collision with local tools.
 * exec() delegates to MCP Client's callTool(), using the ORIGINAL name (without prefix).
 */
export function mcpToolToInjectable(
  mcpTool: { name: string; description?: string; inputSchema: Record<string, unknown> },
  serverName: string,
  client: Client
): InjectableTool {
  const prefixedName = `mcp__${serverName}__${mcpTool.name}`

  return {
    name: prefixedName,
    description: mcpTool.description || '',
    input_schema: (mcpTool.inputSchema as unknown as ToolInputSchema),
    enabled: true,
    async exec(input: any): Promise<string> {
      try {
        const result = await client.callTool({
          name: mcpTool.name,    // original name, no prefix
          arguments: input
        })

        if (result.content && Array.isArray(result.content)) {
          return result.content
            .map((block: any) => {
              if (block.type === 'text') return block.text
              return JSON.stringify(block)
            })
            .join('\n')
        }
        return JSON.stringify(result)
      } catch (err: any) {
        return `MCP tool error (${serverName}/${mcpTool.name}): ${err.message || String(err)}`
      }
    }
  }
}

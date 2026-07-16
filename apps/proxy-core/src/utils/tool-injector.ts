/**
 * MCP Tool 注入器 —— 向 /api/chat 请求体注入已启用的 MCP tools。
 *
 * 只注入 MCP tools（不含 probe/curl），让裸请求也能使用 MCP tool。
 * 追加到末尾以保护 prompt cache（Anthropic 按 tools → system → messages 顺序算前缀哈希）。
 */

import { mcpManager } from './mcp-manager.js'

/**
 * 向请求体只注入 MCP tools（不含 probe/curl），用于 /api/chat 增强接口。
 * 无 tools 数组时自动创建，让裸请求也能使用 MCP tool。
 */
export function injectMcpTools(body: any): string[] {
  if (!Array.isArray(body?.tools)) {
    body.tools = []
  }

  const injected: string[] = []
  for (const tool of mcpManager.getMcpTools()) {
    if (!tool.enabled) continue
    if (body.tools.some((t: any) => t?.name === tool.name)) continue
    body.tools.push({
      name: tool.name,
      description: tool.description,
      input_schema: tool.input_schema
    })
    injected.push(tool.name)
  }
  return injected
}

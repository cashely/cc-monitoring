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
  // 守卫：malformed body 直接返回，避免给原始值赋值抛 TypeError。
  // 判定依据：有效 chat body 至少要有 messages 数组；null/非对象，或既无 tools 也无 messages（如 {}、{tools:'nope'}）均不注入。
  if (
    body === null ||
    typeof body !== 'object' ||
    (!Array.isArray(body?.tools) && !Array.isArray(body?.messages))
  ) {
    return []
  }

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

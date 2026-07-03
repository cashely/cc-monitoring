/**
 * Tool 注入器（后端）——在 proxy 转发给上游前，向请求体 tools 数组末尾注入已启用的自定义 tool。
 *
 * 仅对主对话请求生效（tools 为非空数组）；辅助请求（无 tools）不动，避免破坏其模型约束。
 * 追加到 tools 末尾以保护 prompt cache（Anthropic 按 tools → system → messages 顺序算前缀哈希，
 * 往中间/前面插会连带击穿 system 缓存）。详见 docs/thinks/llm-request-response-patterns.md 6.2。
 */

import { enabledTools } from '../tools/index.js'

/**
 * 向请求体 tools 末尾注入所有已启用的自定义 tool。
 * 只写入 name/description/input_schema（Anthropic 三件套），本地元数据不进请求体。
 *
 * 直接原地修改 body.tools，返回本次实际注入的 tool 名数组（空数组表示未注入）。
 */
export function injectTools(body: any): string[] {
  if (!Array.isArray(body?.tools) || body.tools.length === 0) return []

  const injected: string[] = []
  for (const tool of enabledTools()) {
    // 幂等：已存在同名 tool 则不重复注入
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

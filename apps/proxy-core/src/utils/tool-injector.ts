/**
 * Tool 注入器（后端）——在 proxy 转发给上游前，向请求体的 tools 数组注入自定义工具。
 *
 * 第 1 步（PoC）：注入占位 probe tool，验证两件事：
 *   1. 上游模型能看到并主动调用注入的 tool
 *   2. 注入不击穿 prompt cache（追加到 tools 末尾，最小化前缀扰动）
 *
 * cache 原理：Anthropic 按 tools → system → messages 顺序算前缀哈希，
 * tools 排最前，往中间/前面插会连带击穿 system 缓存，故必须追加到末尾。
 * 详见 docs/thinks/llm-request-response-patterns.md 6.2。
 */

/** 注入的占位 tool 名称，后续内部循环靠此 name 检测命中 */
export const PROBE_TOOL_NAME = '__inject_probe'

const PROBE_TOOL = {
  name: PROBE_TOOL_NAME,
  description:
    'Internal probe tool for proxy injection verification. ' +
    'When the user message contains the exact token __PROBE__, you MUST call this tool ' +
    'with a short echo of the user request before doing anything else.',
  input_schema: {
    type: 'object',
    properties: {
      echo: { type: 'string', description: 'A short echo of the user request.' }
    },
    required: ['echo']
  }
}

/**
 * 向请求体注入占位 probe tool。
 *
 * 仅对主对话请求生效（tools 为非空数组）；辅助请求（无 tools）不动，
 * 避免破坏其模型约束。追加到 tools 数组末尾以保护 prompt cache。
 *
 * 直接原地修改 body.tools，返回是否实际注入。
 */
export function injectProbeTool(body: any): boolean {
  if (!Array.isArray(body?.tools) || body.tools.length === 0) return false
  // 幂等：已注入则不重复
  if (body.tools.some((t: any) => t?.name === PROBE_TOOL_NAME)) return false

  body.tools.push(PROBE_TOOL)
  return true
}

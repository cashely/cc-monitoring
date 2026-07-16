import type { InjectableTool } from './types.js'
import { probeTool } from './probe.tool.js'
import { curlTool } from './curl.tool.js'
import { mcpManager } from '../utils/mcp-manager.js'

/**
 * 自定义 tool 注册表（后端）。
 *
 * 新增 tool：在 tools/ 下新建 xxx.tool.ts 导出 InjectableTool，
 * 再到 ALL_TOOLS 登记一行即可。
 * MCP tools 通过 mcpManager.getMcpTools() 动态合并。
 */

/** 所有本地已知 tool */
const ALL_TOOLS: InjectableTool[] = [probeTool, curlTool]

/** 所有已知 tool（本地 + MCP 动态） */
function allKnownTools(): InjectableTool[] {
  return [...ALL_TOOLS, ...mcpManager.getMcpTools()]
}

/** 已启用的 tool 列表（注入用） */
export function enabledTools(): InjectableTool[] {
  return allKnownTools().filter((t) => t.enabled)
}

/** 是否存在任何启用 tool（决定 proxy 是否进入缓冲检测路径） */
export function hasEnabledTools(): boolean {
  return allKnownTools().some((t) => t.enabled)
}

/** 按名查找已启用 tool（命中检测 + 执行用） */
export function findEnabledTool(name: string): InjectableTool | undefined {
  return allKnownTools().find((t) => t.enabled && t.name === name)
}

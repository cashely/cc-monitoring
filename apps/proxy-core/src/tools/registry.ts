import type { InjectableTool } from './types.js'
import { probeTool } from './probe.tool.js'

/**
 * 自定义 tool 注册表（后端）。
 *
 * 新增 tool：在 tools/ 下新建 xxx.tool.ts 导出 InjectableTool，
 * 再到 ALL_TOOLS 登记一行即可。
 */

/** 所有已知 tool */
const ALL_TOOLS: InjectableTool[] = [probeTool]

/** 已启用的 tool 列表（注入用） */
export function enabledTools(): InjectableTool[] {
  return ALL_TOOLS.filter((t) => t.enabled)
}

/** 是否存在任何启用 tool（决定 proxy 是否进入缓冲检测路径） */
export function hasEnabledTools(): boolean {
  return ALL_TOOLS.some((t) => t.enabled)
}

/** 按名查找已启用 tool（命中检测 + 执行用） */
export function findEnabledTool(name: string): InjectableTool | undefined {
  return ALL_TOOLS.find((t) => t.enabled && t.name === name)
}

import type { InjectableTool } from './types.js'

/**
 * 示例 tool：proxy 注入验证探针（由 PoC 的 __inject_probe 改造而来）。
 *
 * 默认 enabled: false —— 不影响正常请求。置 true 并重启服务即可端到端复现 PoC：
 * user 消息含 __PROBE__ 时模型会调用它，proxy 内部执行 exec 后合成 text 回写。
 */
export const probeTool: InjectableTool = {
  name: '__inject_probe',
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
  },
  enabled: false,
  exec(input) {
    const echo = input?.echo ?? '(no echo)'
    return (
      `Probe executed. Received echo: "${echo}". ` +
      `Now answer the user's actual question directly; do NOT call __inject_probe again.`
    )
  }
}

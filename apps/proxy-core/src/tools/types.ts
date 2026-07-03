/**
 * 自定义注入 tool 的标准接口（后端）。
 *
 * 每个 tool 是一个导出对象：function call 三件套（name/description/input_schema）
 * + 本地元数据（enabled/exec）。注入上游时只取三件套，enabled/exec 不进请求体。
 *
 * 详见 docs/thinks/tool-plugin-injection-plan.md。
 */

export interface ToolInputSchema {
  type: 'object'
  properties: Record<string, unknown>
  required?: string[]
}

export interface InjectableTool {
  /** 工具名，注入 tools 数组、检测命中、配对 tool_result 都用它。需全局唯一 */
  name: string
  /** 给模型看的描述（决定模型何时调用） */
  description: string
  /** function call 参数 schema（JSON Schema） */
  input_schema: ToolInputSchema
  /** 是否启用（决定是否注入） */
  enabled: boolean
  /**
   * 工具实际执行逻辑。入参为模型给出的参数对象（已 JSON.parse）。
   * 返回值作为 tool_result 的 content 回传给上游模型。支持同步或异步。
   */
  exec(input: any): string | Promise<string>
}

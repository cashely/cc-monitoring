# 插件式自定义 Tool 注入机制 —— 设计与实施计划

> 目标：把当前写死单个 `__inject_probe` 的 PoC，泛化为**插件式注入机制**。
> `src/tools/` 下每个 tool 导出标准对象（`name` + function-call schema + `exec`），
> 由注册表统一管理；proxy 侧面向「任意已启用 tool」工作，不再硬编码工具名。
>
> 承接：`docs/thinks/llm-request-response-patterns.md`（PoC 验证结论）。

---

## 一、已确认的设计决策

| 决策点 | 选择 |
|--------|------|
| **exec 入参** | `exec(input)` —— 只接收模型 function call 的参数对象（标准语义），不传上下文 |
| **结果呈现** | 沿用内部循环 + 伪装 text（命中 → 执行 exec → 追加 tool_result 再调上游 → 直到 end_turn → 合成 text 流回） |
| **probe 去留** | 改造为 `tools/` 下的**示例 tool** 保留（默认 `enabled: false`） |
| **注入开关** | **无全局 env 开关**；每个 tool 自带 `enabled` 字段，注册表按 `enabled` 决定注入集合 |

**关键约束（保护正常请求）**：注册表中**没有任何 enabled tool 时，完全走原 pipe 路径**，对正常流式体验零影响。仅当存在启用 tool 时，主对话 SSE 请求才进入「收全流缓冲 + 检测」路径（牺牲首字节延迟，属 PoC 待评估风险，符合当前验证阶段）。

---

## 二、Tool 标准接口

```typescript
// apps/proxy-core/src/tools/types.ts
export interface ToolInputSchema {
  type: 'object'
  properties: Record<string, unknown>
  required?: string[]
}

/** 自定义注入 tool 的标准定义（贴合 Anthropic function call schema） */
export interface InjectableTool {
  /** 工具名，注入 tools 数组、检测命中、配对 tool_result 都用它。需全局唯一 */
  name: string
  /** 给模型看的描述（决定模型何时调用） */
  description: string
  /** function call 参数 schema（JSON Schema） */
  input_schema: ToolInputSchema
  /** 是否启用（决定是否注入）。默认按对象字面量给定 */
  enabled: boolean
  /**
   * 工具实际执行逻辑。入参为模型给出的参数对象（已 JSON.parse）。
   * 返回值作为 tool_result 的 content 回传给上游模型。
   * 支持同步或异步。
   */
  exec(input: any): string | Promise<string>
}
```

**注入给上游的字段**只取 `name/description/input_schema`（Anthropic 要求的三件套）；`enabled/exec` 是本地元数据，不进请求体。

---

## 三、目录与文件规划

新建 `apps/proxy-core/src/tools/`：

```
src/tools/
├── types.ts          # InjectableTool 接口定义（上方）
├── registry.ts       # 注册表：收集所有 tool、提供 enabled 列表 + 按名查找
├── index.ts          # 汇总导出（barrel）
└── probe.tool.ts     # 示例 tool（由现有 __inject_probe 改造，默认 enabled: false）
```

### registry.ts 职责

```typescript
import { InjectableTool } from './types.js'
import { probeTool } from './probe.tool.js'

/** 所有已知 tool（新增 tool 在此登记一行） */
const ALL_TOOLS: InjectableTool[] = [probeTool]

/** 已启用的 tool 列表 */
export function enabledTools(): InjectableTool[] {
  return ALL_TOOLS.filter((t) => t.enabled)
}

/** 是否存在任何启用 tool（决定 proxy 是否进入缓冲路径） */
export function hasEnabledTools(): boolean {
  return ALL_TOOLS.some((t) => t.enabled)
}

/** 按名查找已启用 tool（命中检测 + 执行用） */
export function findEnabledTool(name: string): InjectableTool | undefined {
  return ALL_TOOLS.find((t) => t.enabled && t.name === name)
}
```

### probe.tool.ts（示例）

由现有 `tool-injector.ts` 的 `PROBE_TOOL` + `inject-loop.ts` 的 `mockProbeExecute` 合并而来：

```typescript
import { InjectableTool } from './types.js'

export const probeTool: InjectableTool = {
  name: '__inject_probe',
  description:
    'Internal probe tool for proxy injection verification. ' +
    'When the user message contains the exact token __PROBE__, you MUST call this tool ...',
  input_schema: {
    type: 'object',
    properties: { echo: { type: 'string', description: 'A short echo of the user request.' } },
    required: ['echo']
  },
  enabled: false, // 示例默认关闭；置 true 即可端到端复现 PoC
  exec(input) {
    const echo = input?.echo ?? '(no echo)'
    return `Probe executed. Received echo: "${echo}". Now answer the user's actual question directly; do NOT call __inject_probe again.`
  }
}
```

---

## 四、改造 tool-injector.ts（泛化注入）

现在写死 `injectProbeTool`，改为面向注册表：

```typescript
import { enabledTools } from '../tools/index.js'

/**
 * 向请求体 tools 末尾注入所有已启用的自定义 tool。
 * 仅对主对话请求生效（tools 为非空数组）；追加末尾保护 prompt cache。
 * 返回本次实际注入的 tool 名数组（空数组表示未注入）。
 */
export function injectTools(body: any): string[] {
  if (!Array.isArray(body?.tools) || body.tools.length === 0) return []
  const injected: string[] = []
  for (const tool of enabledTools()) {
    if (body.tools.some((t: any) => t?.name === tool.name)) continue // 幂等
    body.tools.push({ name: tool.name, description: tool.description, input_schema: tool.input_schema })
    injected.push(tool.name)
  }
  return injected
}
```

保留原 `PROBE_TOOL_NAME` 导出会被移除（迁到 probe.tool.ts），其它模块改引用注册表。

---

## 五、改造 inject-loop.ts（泛化检测与执行）

SSE 解析（`parseSSEText` / `parseUpstreamEvents`）无关工具名，**保持不变**。改动检测与执行：

```typescript
import { findEnabledTool } from '../tools/index.js'

/** 找出命中的、已启用的注入 tool 调用块（替代 findProbeCall） */
export function findInjectedCall(parsed: ParsedUpstream): ParsedBlock | undefined {
  return parsed.blocks.find(
    (b) => b.type === 'tool_use' && b.name && findEnabledTool(b.name)
  )
}
```

`runInjectLoop` 内部：把写死的 `mockProbeExecute(probe.input)` 改为**按命中 tool 名查注册表并执行其 exec**：

```typescript
while (iterations < maxIterations) {
  const call = findInjectedCall(parsed)
  if (!call || parsed.stopReason !== 'tool_use') {
    return { text: collectText(parsed), iterations, stoppedByLimit: false }
  }
  const tool = findEnabledTool(call.name!)!        // findInjectedCall 已保证存在
  const result = await tool.exec(call.input)        // 支持 async
  opts.body.messages.push({ role: 'assistant', content: blocksToAssistantContent(parsed.blocks) })
  opts.body.messages.push({
    role: 'user',
    content: [{ type: 'tool_result', tool_use_id: call.id, content: result }]
  })
  parsed = parseUpstreamEvents(await opts.callUpstream(opts.body))
  iterations++
}
```

删除 `mockProbeExecute`（逻辑迁进 probe.tool.ts 的 exec）与 `PROBE_TOOL_NAME` 依赖。

> 注：多个 tool 同轮命中时，本轮先处理第一个命中块。多 tool 并发命中的完整处理留待后续（PoC 阶段单 tool 足够，避免过度设计）。

---

## 六、改造 proxy.ts（开关逻辑换成注册表）

第 231–237 行的 `INJECT_PROBE` env 判断，改为注册表驱动：

```typescript
// 旧：if (process.env.INJECT_PROBE === '1') { injected = injectProbeTool(...) }
// 新：
let injectedNames: string[] = []
if (hasEnabledTools()) {
  injectedNames = injectTools(request.body)
  if (injectedNames.length) request.log.info(`[inject] tools injected: ${injectedNames.join(',')} (${request.id})`)
}
const injected = injectedNames.length > 0
```

第 305 行条件缓冲分支：`injected && isSSE` 判断不变，内部把 `findProbeCall` 换成 `findInjectedCall`。其余（合成 SSE 回写、DB 存储、pushNewRequest）不动。

`shouldMock`（`__MOCK__` 魔法词）与合成 SSE 回写路径**保持不变**（独立的 PoC 验证入口）。

---

## 七、验证方案

沿用 PoC 文档的「唯一裁判是日志 + DB」原则（回复内容不可作为依据）：

1. **零启用 tool（默认）**：所有 tool `enabled: false` → `hasEnabledTools()` 为 false → 走原 pipe，正常请求零影响。构建通过即可。
2. **启用 probe 示例**：将 `probe.tool.ts` 的 `enabled` 置 `true`，重启服务，发含 `__PROBE__` 的请求。验证：
   - DB `request_body.tools` 末尾含 `__inject_probe`（注入生效）
   - DB `response_events` 中 `stop_reason=tool_use` 且 `tool_use.name=__inject_probe`（命中）
   - 日志三行：`tools injected → probe hit/entering loop → loop done`（闭环）
   - 客户端收到合成 text，无「未知工具」报错
3. **构建**：`pnpm build:proxy-core` 成功（TS 严格模式）。

---

## 八、改动文件清单

| 文件 | 动作 |
|------|------|
| `src/tools/types.ts` | 新增：InjectableTool 接口 |
| `src/tools/registry.ts` | 新增：注册表 |
| `src/tools/probe.tool.ts` | 新增：probe 示例 tool（迁移自旧代码） |
| `src/tools/index.ts` | 新增：barrel 导出 |
| `src/utils/tool-injector.ts` | 改造：`injectProbeTool` → `injectTools`（注册表驱动） |
| `src/utils/inject-loop.ts` | 改造：`findProbeCall` → `findInjectedCall`；exec 查注册表；删 `mockProbeExecute` |
| `src/server/proxy.ts` | 改造：env 开关 → `hasEnabledTools()`；`findProbeCall` → `findInjectedCall` |

**不改动**：`sse-writer.ts`、`sse-accumulator.ts`、SSE 解析逻辑、DB/push 逻辑、`shouldMock` 路径。

> 文档 `llm-request-response-patterns.md` 附录的代码位置指引待机制落地后另行更新（不在本次编码范围，除非你要求同步）。

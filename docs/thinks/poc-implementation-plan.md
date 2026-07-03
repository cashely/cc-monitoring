# PoC 实施计划：Tool Injection 底层协议验证

分支：`feature/tool-injection-poc`

## 目标

验证「proxy 自己构造的合成 SSE 流，能否被 Claude Code 客户端识别为一次正常的文本回答」。这是整个 Tool Injection 方案最底层的协议可行性，走通后续都是业务逻辑填充。

**本 PoC 不做**：不注入 tool、不解析 tool_use、不做内部循环、不调真实大模型判定。只验证「构造 SSE → 客户端接收展示」这一条链路。

## 触发方式（已确认）

**魔法词触发**：仅当用户最新一条 user message 的文本包含 `__MOCK__` 时，proxy 拦截该请求、**不转发上游**，直接用构造的 SSE 流返回一段固定 mock 文本。其余所有请求走原有 `pipe` 透传，零影响。

选择理由：可精确复现、随时手动触发、完全不污染日常使用（对比「随机 10%」不可预测、会替换真实回答）。

## 改动清单（最小）

### 1. 新建 `apps/proxy-core/src/utils/sse-writer.ts`

SSE 构造器（后端）。核心两个函数：

```typescript
import type { ServerResponse } from 'http'

export function writeSSEEvent(raw: ServerResponse, event: object): void {
  raw.write(`data: ${JSON.stringify(event)}\n\n`)
}

// 把一段文本伪装成模型的正常 text 输出，构造完整合成流写回
export function writeTextAsSSE(raw: ServerResponse, text: string, messageId: string): void {
  writeSSEEvent(raw, { type: 'message_start', message: { type: 'message', id: messageId, role: 'assistant', content: [], model: 'auto', stop_reason: null, stop_sequence: null, usage: { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0 } } })
  writeSSEEvent(raw, { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })
  writeSSEEvent(raw, { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } })
  writeSSEEvent(raw, { type: 'content_block_stop', index: 0 })
  writeSSEEvent(raw, { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 0 } })
  writeSSEEvent(raw, { type: 'message_stop' })
}
```

- 事件骨架完全遵循探索文档第三部分实测结构。
- `messageId` 由 proxy 自己生成（合成流，无上游 id），全程一致，`index` 从 0 连续。

### 2. 修改 `apps/proxy-core/src/server/proxy.ts`

在 `fetch`（212 行）**之前**加一个魔法词检测分叉：

```typescript
// 位置：requestData 构建之后、fetch 之前
if (shouldMock(request.body)) {
  reply.hijack()
  reply.raw.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache',
    'connection': 'keep-alive'
  })
  writeTextAsSSE(reply.raw, '[PoC] 这是 proxy 构造的合成响应，未经过真实大模型。', `msg_poc_${request.id}`)
  reply.raw.end()
  request.log.info(`[PoC] mock intercepted: ${request.id}`)
  return
}
```

`shouldMock` 辅助函数（同文件内，或放进 sse-writer.ts）：从 `body.messages` 取最后一条 `role==='user'` 的消息，兼容 content 是 string 或 block 数组两种形态，判断是否包含 `__MOCK__`。

### 3. 测试 `apps/proxy-core/src/utils/__tests__/sse-writer.test.ts`

Jest 单测，用一个 mock ServerResponse（收集 write 调用），验证：
- `writeTextAsSSE` 输出事件顺序正确（message_start → block_start → delta → block_stop → message_delta → message_stop）
- 每行以 `data: ` 开头、`\n\n` 结尾
- text_delta 内容正确、message_id 一致

## 验证步骤（成功标准）

1. `pnpm --filter @cc-monitoring/cli-core test` — sse-writer 单测通过
2. `pnpm build:proxy-core` — 构建成功
3. **端到端手动验证**：启动 proxy，在 Claude Code 里发一条含 `__MOCK__` 的消息 → 客户端应正常展示那段 mock 文本、无报错、无渲染错位 → **协议验证通过**
4. 发一条不含 `__MOCK__` 的正常消息 → 确认走原有透传、行为无变化

## 不在本次范围（后续 PR）

- 拦截时机 A/B（全缓冲 vs 边转边探）——PoC 不转发上游，整个绕过
- tool 注入到 tools 数组末尾 + cache_read_input_tokens 对比验证
- tool_use 解析、内部循环、真实大模型调用
- 中间状态回写（「正在执行...」占位）

## Code Review + 构建闸门

按 CLAUDE.md：编码完成后先自查 code review，再跑构建，两者都通过才提交 commit。

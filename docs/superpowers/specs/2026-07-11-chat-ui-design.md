# Chat UI Design Spec

## Summary

完善 chat-ui 对话面板，使用 @ant-design/x 组件库实现上下布局（对话记录 + 输入框），通过 server exec API 与 claude code 交互，支持 SSE streaming 多轮对话。

## Architecture

### Server Side (`ui-route.ts`)

**ExecRequestBody 扩展**：
```typescript
interface ExecRequestBody {
  tool: 'claude'
  prompt: string
  stream?: boolean
  sessionId?: string  // 新增：claude 会话 ID
}
```

**ExecResponse 扩展**（非 stream 模式）：
```typescript
interface ExecResponse {
  success: boolean
  output?: string
  error?: string
  sessionId?: string  // 新增：server 生成的 UUID
}
```

**spawn 命令逻辑**：
- 有 sessionId → `spawn('claude', ['-r', sessionId, '-p', prompt])`
- 无 sessionId → `spawn('claude', ['--session-id', uuid(), '-p', prompt])`，server 用 `crypto.randomUUID()` 生成 UUID

**SSE event 扩展**（stream 模式）：

新增 `session` event，在流开头发送：
```
event: session
data: <uuid>
```

`data` event 改为 JSON 格式区分 stdout/stderr：
```
event: data
data: {"type":"stdout","content":"..."}
event: data
data: {"type":"stderr","content":"..."}
```

`error` / `done` event 保持不变。

新对话：先发 `session` event → 再发 `data` events → 最后 `done`。
继续对话：不发 `session` event（前端已知 sessionId）。

### Frontend (`ChatUI.tsx`)

**布局**：上下结构，无标题 header
```tsx
<div className="h-full flex flex-col">
  <Bubble.List className="flex-1 overflow-y-auto" items={...} />
  <Sender onSubmit={handleSubmit} placeholder={...} />
</div>
```

**数据流**：
1. 用户输入 → `POST /ui/api/exec` `{ tool: 'claude', prompt, stream: true, sessionId? }`
2. SSE：`session` event → 存 sessionId；`data(stdout)` → 实时更新 Bubble；`data(stderr)` → 错误提示；`done` → 结束
3. localStorage 恢复对话历史

**对话管理**：
- 新对话：不带 sessionId → server 生成新 UUID → SSE 返回
- 继续对话：带 sessionId → server 用 `-r` flag
- "新对话"按钮：清除当前 sessionId

### localStorage

```typescript
interface ChatConversation {
  sessionId: string
  messages: ChatMessage[]
}

interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: number
}
```

key: `cc-chat-conversations`

流式累积 stdout 后才写入 localStorage（避免存半截数据）。

### Dependencies

`@ant-design/x` 新增到 `apps/proxy-cli/package.json`

### Not Modified

- `proxy.ts` — 零改动，不侵入原始转发逻辑
- 其他 UI 组件 — 零改动

## Key Decisions

1. **SessionId 生成策略**：server 生成 UUID + `--session-id` flag，而非从 proxy headers 提取。原因：零侵入 proxy.ts，可插拔，claude 原生支持
2. **SSE data 格式**：改为 JSON `{ type, content }`，区分 stdout/stderr。前端 stderr 不拼入 assistant content，仅作错误提示
3. **localStorage 持久化**：刷新后可恢复对话历史和 sessionId
4. **Ant Design X**：使用 Bubble + Bubble.List + Sender 组件，符合项目"统一使用 Ant Design"规范

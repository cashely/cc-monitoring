# LLM 请求/响应规律探索 —— Tool Injection 可行性

> 探索目标：分析 proxy 最近 20 条请求/响应数据，找出 Anthropic Messages API 的请求格式、分类、数据结构规律，评估「在 proxy 转发给真实大模型前注入自定义 tool，命中后内部循环再调大模型」方案的可行性。
>
> 数据来源：`logs/proxy.db` 的 `requests` 表（`request_body` / `response_events` 字段）。
> 探索日期：2026-07-03。

---

## 一、数据总览

最近 20 条全部是 **Anthropic Messages API** 协议：`POST /v1/messages?beta=true`，`stream: true`（SSE），目标模型 `ark-code-latest`。请求分两类：

| 类型 | 特征 | 示例 |
|------|------|------|
| **主对话请求** | 带 27 个 tools、system 3 段、messages 几十条、体积 100KB+ | id=150 (137KB) |
| **辅助请求** | 无 tools、单条 message、体积小 | id=133「生成会话标题」(2KB) |

---

## 二、请求体（request_body）结构规律

顶层固定字段：

```jsonc
{
  "model": "ark-code-latest",
  "max_tokens": 32000,
  "stream": true,
  "system": [ /* text 块数组 */ ],
  "messages": [ /* 对话数组 */ ],
  "tools": [ /* 工具定义数组，27个 */ ],
  "tool_choice": null,          // 未强制，模型自主决定
  "metadata": { "user_id": "{device_id,account_uuid,session_id}" },
  "thinking": {...},            // 可选
  "context_management": {...},  // 可选
  "output_config": { "effort": "high" }
}
```

**关键规律：**

1. **`tools` 数组**：每个元素 `{ name, description, input_schema(JSON Schema) }`。这正是注入点——往这个数组 append 你的自定义 tool 即可。
2. **`system`**：text 块数组，后两段带 `cache_control: {type:"ephemeral"}`（prompt cache 断点）。
3. **`messages` 对话轮次**（核心）：
   - `user` 内容可以是 **string** 或 **block 数组**
   - `assistant` 块：`text` + `tool_use({id, name, input})`
   - `user` 回传工具结果：`tool_result({tool_use_id, content, is_error})`
   - `tool_use.id` ↔ `tool_result.tool_use_id` **配对**，这是多轮工具循环的锚点

### messages 实例（id=150，节选）

```
[0] user: blocks=[text×5]              # system-reminder / command / 用户问题
[1] system: (str)                      # hook 注入的上下文
[2] assistant: [text, tool_use(Bash)]
[3] user: [tool_result]                # 与 [2] 的 tool_use.id 配对
[4] assistant: [tool_use(Read)]
[5] user: [tool_result]
...
[37] user: [text, cache_control:ephemeral]   # 最新一轮用户输入，带 cache 断点
```

---

## 三、响应体（response_events）结构规律

存储为 **SSE 事件对象数组**。骨架固定：

```
message_start                              // message.content=[], usage 初始
  content_block_start  (index=0, text)     // 每个内容块开始
    content_block_delta (text_delta)  × N  // 文本增量
  content_block_stop
  content_block_start  (index=1, tool_use{id,name,input:{}})  // 工具块
    content_block_delta (input_json_delta) × N   // input 的 JSON 分片累加
  content_block_stop
message_delta  { stop_reason, usage }      // 结束原因 + 最终 token
message_stop
```

**关键规律（决定注入检测点）：**

1. **`stop_reason` 二态**：
   - `"end_turn"` → 纯文本回答，对话结束
   - `"tool_use"` → **模型要调用工具**，命中注入 tool 就看这里
2. **命中检测**：遍历 `content_block_start`，若 `content_block.type === "tool_use"` 且 `name === 你注入的工具名` → 命中。其 `input` 参数通过后续 `input_json_delta.partial_json` **分片累加**，需拼接后 `JSON.parse`。
3. 一次响应可含 **多个块**（text + 多个 tool_use 并存）。

### message_start 结构

```json
{
  "type": "message_start",
  "message": {
    "type": "message", "id": "...", "role": "assistant",
    "content": [], "model": "auto",
    "stop_reason": null, "stop_sequence": null,
    "usage": { "input_tokens": 0, "output_tokens": 0, "cache_read_input_tokens": 0 }
  }
}
```

### 结尾事件对比

```
# 纯文本（id=133）
message_delta { "stop_reason": "end_turn", "usage": {...} }
message_stop

# 带工具调用（id=146）
message_delta { "stop_reason": "tool_use", "usage": {"output_tokens": 1657, "cache_read_input_tokens": 43993} }
message_stop
```

---

## 四、Tool Injection 实现方案（可行性确认）

设想**完全可行**，属于标准的 agentic loop。在 `proxy.ts` 转发前后各插一层：

```
Claude Code
   │ ①原始请求
   ▼
[Proxy 注入层]
   │ ②tools.push(你的自定义tool) → 转发
   ▼
真实大模型
   │ ③SSE 响应
   ▼
[Proxy 检测层] ── stop_reason=="tool_use" 且命中注入tool？
   │                        │是
   │否→原样 pipe 回          ▼
   ▼                  [内部循环]
Claude Code          执行你的tool逻辑 → 造 tool_result
                     → 把 assistant(tool_use)+user(tool_result) 追加进 messages
                     → 再次调大模型 → 直到 stop_reason==end_turn
                     → 把最终结果重新编码成 SSE 流回 Claude Code
```

**实现要点（基于现有代码）：**

- **注入位置**：`proxy.ts` 现在直接 `fetch(targetUrl, {body: JSON.stringify(payload)})`。改成先 `payload.tools.push(injectedTool)` 再转发。
- **难点在响应端**：现有架构是 `Readable.fromWeb(response.body).pipe(reply.raw)` **纯透传**。要做内部循环，命中注入 tool 时**不能直接 pipe**，必须：
  1. 先完整消费 SSE、解析出 tool_use（复用已有的 SSE 累加逻辑，`apps/proxy-cli/src/utils/parse-events.ts` 里已有拼接代码）
  2. 命中 → 内部循环（不 pipe，缓冲）；未命中 → 照常 pipe
  3. 循环期间对 Claude Code **保持 SSE 连接**，最终把内部循环产出的文本重新用 SSE 事件格式（`message_start`/`content_block_delta`/`message_stop`）编码回写
- **关键约束**：Claude Code 侧看到的 `tool_use.name` 必须是它认识的工具，否则它会尝试执行。**注入的 tool 命中后要在 proxy 内部消化掉**，不能透传给 Claude Code——否则它不认识这个工具名会报错。

---

## 五、关键决策（已确定）

编码前的设计选择已敲定：

| 决策点 | 选择 | 理由 |
|--------|------|------|
| **1. 注入时机** | **仅主对话请求**（带 tools 的） | 辅助请求（如标题生成）带强模型约束，注入额外 tool 可能导致 API 校验失败或增加 token 成本。 |
| **2. 结果呈现** | **伪装成 text 结果** | 将工具输出转成 `text` 块返回，Claude Code 视其为一次正常模型输出，无需对客户端做侵入性改动，规避工具解析检查。 |
| **3. 流式处理** | **中间状态回写** | 内部循环期间实时推送 `text` 增量（如「正在执行自定义工具: xxx...」），保持 SSE 连接、避免客户端超时断开、给用户即时反馈。 |

---

## 六、实现细节补充

### 6.1 SSE 回写能力：需新写后端构造器，不能复用 parse-events.ts

一个关键澄清：**回写合法 SSE 响应包需要新写一个后端工具**，现有代码无法复用。

- **`apps/proxy-cli/src/utils/parse-events.ts` 帮不上忙**，原因三点：
  1. **位置错**：它在 `proxy-cli`（前端 React 面板），回写发生在 `proxy-core`（后端 Fastify）。跨 app 引用违反 monorepo 分层。
  2. **方向反**：它是 `events[] → 结构化对象(ParsedResponse)` 的**解析器**（供面板展示历史），而回写需要的是 `结构化数据 → SSE data 行文本` 的**构造器**，两者互为逆运算。
  3. **粒度不对**：它一次性吃完整 events 数组返回汇总（离线批处理）；回写需逐事件 `reply.raw.write(...)`（在线流式）。
- **`apps/proxy-core/src/utils/sse-accumulator.ts` 同样是解析器**（Transform 流旁路收集事件存 DB），也非构造器。
- **后端现状**（`proxy.ts:285-331`）只有两件事：`nodeStream.on('data')` 旁路解析存 DB + `nodeStream.pipe(reply.raw)` 纯透传。**没有任何构造 SSE 的能力。**

可复用的是**事件骨架知识**（见第三部分），而非代码。构造器很小（不到 30 行）：

```typescript
// apps/proxy-core/src/utils/sse-writer.ts （新文件，后端）
function writeEvent(raw: ServerResponse, event: object) {
  raw.write(`data: ${JSON.stringify(event)}\n\n`)
}

// 把一段文本伪装成模型的正常 text 输出流回
function writeTextAsSSE(raw: ServerResponse, text: string, messageId: string) {
  writeEvent(raw, { type: 'message_start', message: { type:'message', id: messageId, role:'assistant', content:[], model:'auto', stop_reason:null, stop_sequence:null, usage:{input_tokens:0,output_tokens:0,cache_read_input_tokens:0} }})
  writeEvent(raw, { type: 'content_block_start', index: 0, content_block: { type:'text', text:'' }})
  writeEvent(raw, { type: 'content_block_delta', index: 0, delta: { type:'text_delta', text }})
  writeEvent(raw, { type: 'content_block_stop', index: 0 })
  writeEvent(raw, { type: 'message_delta', delta: { stop_reason:'end_turn', stop_sequence:null }, usage:{ output_tokens: 0 }})
  writeEvent(raw, { type: 'message_stop' })
}
```

该构造器直接支撑：PoC 第 2 步「写死固定 text 塞回，验证 Claude Code 接收」；以及决策 3「中间状态回写」（进入循环时先 write 一个 `content_block_delta(text_delta)` 提示占位）。

### 6.2 Prompt Cache 保护：注入 tool 必须追加到 tools 数组末尾

第二部分提到 `system` 带 `cache_control: ephemeral`。「只动 tools、不碰 system」是对的，但**「只动 tools」本身仍可能击穿 system 缓存**：

- Anthropic prompt cache 按 **`tools → system → messages` 顺序**计算前缀哈希。`tools` 排在最前，往其中间/前面插入元素会改变 tools 段序列化结果，**连带击穿后面 system 的缓存**，抬高 `cache_read_input_tokens`、增加费用甚至缓存失效。
- **对策**：注入的 tool **追加到 `tools` 数组末尾**，把前缀扰动降到最小。落地时需**对比注入前后的 `cache_read_input_tokens`** 验证。

### 6.3 响应层拦截约束（呼应第四部分）

命中注入 tool 后，Proxy 必须在响应层**截断该 `tool_use` 的向下传播**——不能让未定义的工具名透传给 Claude Code（否则客户端解析报错）。在内部完成逻辑后，用 6.1 的构造器把结果转成 `text` 塞回。

---

## 七、下一步：PoC 优先级

1. **实现「拦截与透传」中间件**：`proxy.ts` 中写 Switcher，仅探测到特定 `tool_name` 时进入自定义逻辑，其他情况完全走原 `pipe` 流程。
2. **构建 Mock 工具响应**：先不调真实大模型，proxy 内部写死一个固定 JSON/text 响应，测试 Claude Code 能否顺利接收并展示伪装的 `text` 内容。

---

## 附录：相关代码位置

- `apps/proxy-core/src/server/proxy.ts`：Proxy 转发核心（注入层 + 响应拦截要改这里，现状 285-331 行为纯透传）
- `apps/proxy-core/src/utils/sse-accumulator.ts`：SSE 事件**解析器**（Transform 流，存 DB 用）
- `apps/proxy-core/src/utils/request-writer.ts`：请求写入 DB
- `apps/proxy-cli/src/utils/parse-events.ts`：前端**解析器**（events→结构化对象，面板展示用；**非** SSE 构造器，回写不可复用）
- `apps/proxy-core/src/utils/sse-writer.ts`：SSE **构造器**（**待新建**，见 6.1）
- `logs/proxy.db` → `requests` 表：`request_body` / `response_events` 字段

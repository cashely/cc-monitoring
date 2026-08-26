# CC-Monitoring Proxy API 接口文档

## 概述
CC-Monitoring Proxy 是一个应用层转发代理，兼容 Anthropic Messages API。你可以用任何 HTTP 客户端直接请求 proxy 与大模型对话，无需 Claude Code 客户端。

默认地址: `http://localhost:9527`

## 认证

### 客户端 → Proxy
Proxy 的 `/v1/*` 路由**不做认证**。客户端可通过以下方式传递 API key（仅用于日志记录）：
- Header `x-api-key: <your-key>`
- Header `Authorization: Bearer <your-key>`

### Proxy → 上游
Proxy 会用配置的 Provider 的 `api_key` **替换**客户端的 key：
- 如果请求带 `x-api-key` → 替换值
- 如果请求带 `Authorization` → 替换为 `Bearer <provider_key>`
- 都没有 → 注入 `x-api-key: <provider_key>`
- 如果 Provider 未配置 `api_key` → 客户端原始 key 被转发

## 核心接口

### POST /v1/messages

与 Anthropic Messages API 完全兼容的对话接口。

#### 请求 URL

```
POST http://localhost:9527/v1/messages
```

#### 请求 Headers

| Header | 必填 | 说明 |
|---|---|---|
| `content-type` | 是 | `application/json` |
| `x-api-key` | 否* | API key（或用 `Authorization`） |
| `authorization` | 否* | `Bearer <key>` 格式 |
| `anthropic-version` | 否 | Anthropic API 版本，如 `2023-06-01`，会原样转发 |

\* `x-api-key` 和 `authorization` 至少提供一个（除非 Provider 配置了 api_key）

#### 请求 Body (JSON)

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `model` | `string` | 是 | 模型名称，如 `claude-sonnet-4-6`。Proxy 会按 tier 自动重写（见 Model 重写规则） |
| `messages` | `ClaudeMessage[]` | 是 | 对话消息数组 |
| `max_tokens` | `number` | 是 | 最大输出 token 数 |
| `system` | `string \| SystemBlock[]` | 否 | 系统提示词。`SystemBlock = { type: "text", text: string }` |
| `stream` | `boolean` | 否 | `true` 返回 SSE 流，`false` 返回 JSON。默认 `false` |
| `temperature` | `number` | 否 | 采样温度，0-1 |
| `top_p` | `number` | 否 | nucleus sampling |
| `top_k` | `number` | 否 | top-k sampling（仅 Claude 模式支持，OpenAI 兼容模式下被忽略） |
| `stop_sequences` | `string[]` | 否 | 停止序列 |
| `tools` | `ClaudeTool[]` | 否 | 工具定义 |
| `tool_choice` | `ToolChoice` | 否 | 工具选择策略 |
| `metadata` | `object` | 否 | 请求元数据（仅 Claude 模式支持，OpenAI 兼容模式下被忽略） |

**ClaudeMessage 结构：**

```json
{
  "role": "user" | "assistant",
  "content": "string 或 ContentBlock[]"
}
```

**ContentBlock 类型：**

| type | 字段 | 说明 |
|---|---|---|
| `text` | `text: string` | 文本内容 |
| `image` | `source: { type: "base64", media_type: string, data: string }` | 图片（base64） |
| `tool_use` | `id: string, name: string, input: object` | 工具调用 |
| `tool_result` | `tool_use_id: string, content: string` | 工具结果 |

**ClaudeTool 结构：**

```json
{
  "name": "string",
  "description": "string (可选)",
  "input_schema": { /* JSON Schema */ }
}
```

**ToolChoice 结构：**

```json
{ "type": "auto" | "any" | "tool", "name": "string (type='tool'时必填)" }
```

#### Model 重写规则

Proxy 会根据 Provider 配置的 tier model 自动重写请求中的 `model` 字段：

| 请求 model 前缀 | 重写目标 | 说明 |
|---|---|---|
| `claude-haiku*` | Provider 的 `haiku_model` | 无配置则用 `model` 字段 |
| `claude-sonnet*` | Provider 的 `sonnet_model` | 无配置则用 `model` 字段 |
| `claude-opus*` | Provider 的 `opus_model` | 无配置则用 `model` 字段 |
| 其他 | Provider 的 `model` | 无 tier 匹配 |

#### 响应格式

##### 非流式响应 (stream: false)

```json
{
  "id": "msg_01XFDUDYJgAACzvnptvVoYEL",
  "type": "message",
  "role": "assistant",
  "model": "claude-sonnet-4-6",
  "content": [
    { "type": "text", "text": "Hi! How can I help you?" }
  ],
  "stop_reason": "end_turn",
  "stop_sequence": null,
  "usage": {
    "input_tokens": 25,
    "output_tokens": 10
  }
}
```

**stop_reason 取值：**

| 值 | 含义 |
|---|---|
| `end_turn` | 自然结束 |
| `max_tokens` | 达到 max_tokens 上限 |
| `stop_sequence` | 遇到 stop_sequences |
| `tool_use` | 模型请求工具调用 |

##### 流式响应 (stream: true)

返回 SSE (Server-Sent Events) 流，`Content-Type: text/event-stream`。

事件序列：

```
event: message_start
data: {"type":"message_start","message":{"id":"msg_...","type":"message","role":"assistant","model":"...","content":[],"stop_reason":null,"usage":{"input_tokens":25,"output_tokens":0}}}

event: content_block_start
data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}

event: content_block_delta
data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello"}}

event: content_block_delta
data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":" world"}}

event: content_block_stop
data: {"type":"content_block_stop","index":0}

event: message_delta
data: {"type":"message_delta","delta":{"stop_reason":"end_turn","stop_sequence":null},"usage":{"output_tokens":15}}

event: message_stop
data: {"type":"message_stop"}
```

工具调用时的 SSE 事件：

```
event: content_block_start
data: {"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"toolu_...","name":"get_weather","input":{}}}

event: content_block_delta
data: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{\"location\":"}}

event: content_block_delta
data: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"\"San Francisco\"}"}}

event: content_block_stop
data: {"type":"content_block_stop","index":1}
```

#### 错误响应

**Proxy 层错误：**

| HTTP 状态码 | 错误消息 | 场景 |
|---|---|---|
| 502 | `Target server unreachable` / `Target server not found` | 上游服务器不可达 |
| 504 | `Request timeout` | 请求超时（5 分钟） |
| 500 | `Proxy error` | 其他代理错误 |

错误格式：
```json
{
  "error": "Target server unreachable",
  "requestId": "req-abc123"
}
```

**上游错误**（Anthropic 格式）直接透传，例如：

```json
{
  "type": "error",
  "error": {
    "type": "invalid_request_error",
    "message": "model: claude-sonnet-4-6 is not available"
  }
}
```

---

## 通配路由 /v1/*

Proxy 注册了 `fastify.all('/v1/*')` 通配路由，所有 `/v1/` 路径的请求（GET/POST/PUT/DELETE 等）都会转发到上游。例如：

- `POST /v1/messages` → 转发到上游 `/v1/messages`
- `GET /v1/models` → 转发到上游 `/v1/models`（如果上游支持）

Proxy 本身不实现 `/v1/models` 等辅助接口。

---

## 简化对话接口 POST /api/chat

带会话管理功能的对话接口。

#### 请求 URL

```
POST http://localhost:9527/api/chat
```

#### 请求 Headers

| Header | 必填 | 说明 |
|---|---|---|
| `content-type` | 是 | `application/json` |
| `x-chat-session-id` | 否 | 会话 ID，提供后自动加载历史消息 |

#### 请求 Body

与 `/v1/messages` 完全相同，额外支持：
- 不需要每次发送完整历史，`x-chat-session-id` 会自动回填

#### 响应

与 `/v1/messages` 完全相同（JSON 或 SSE）。

#### 与 /v1/messages 的区别

| 特性 | `/v1/messages` | `/api/chat` |
|---|---|---|
| 会话管理 | 无 | 支持（x-chat-session-id） |
| 历史消息 | 客户端自行管理 | 自动回填 |
| MCP 工具注入 | 无 | 支持 |
| Mock 拦截 | 无 | 支持（测试用） |

---

## OpenAI 兼容模式

当 Provider 配置了 `is_openai_compatible: true` 时，Proxy 自动进行协议转换：

### 请求方向：Claude → OpenAI 转换

| Claude 字段 | OpenAI 映射 | 注意 |
|---|---|---|
| `system` | `messages[0].role='system'` | 数组形式拼接为字符串 |
| `messages` | `messages` | role/content 格式转换 |
| `tool_use` content block | `tool_calls` | `input` → `function.arguments` (JSON string) |
| `tool_result` content block | `role='tool'` | `tool_use_id` → `tool_call_id` |
| `image` content block | `image_url` | 转为 data URI |
| `max_tokens` | `max_tokens` | 直传 |
| `temperature` | `temperature` | 直传 |
| `top_p` | `top_p` | 直传 |
| `stop_sequences` | `stop` | 字段名映射 |
| `tools` | `function` tools | `input_schema` → `parameters` |
| `tool_choice.type='auto'\|'any'` | `'auto'` | 'any' 映射为 'auto' |
| `tool_choice.type='tool'` | `{type:'function',function:{name}}` | |
| `top_k` | ⚠️ 丢弃 | OpenAI 无对应 |
| `metadata` | ⚠️ 丢弃 | OpenAI 无对应 |

### 响应方向：OpenAI → Claude 转换

| OpenAI 字段 | Claude 字段 | 转换 |
|---|---|---|
| `choices[0].message.content` | `content[{type:'text'}]` | |
| `choices[0].message.tool_calls` | `content[{type:'tool_use'}]` | `arguments` JSON.parse → `input` |
| `finish_reason: 'stop'` | `stop_reason: 'end_turn'` | |
| `finish_reason: 'length'` | `stop_reason: 'max_tokens'` | |
| `finish_reason: 'tool_calls'` | `stop_reason: 'tool_use'` | |
| `usage.prompt_tokens` | `usage.input_tokens` | |
| `usage.completion_tokens` | `usage.output_tokens` | |

流式模式下的 SSE 事件也会进行对应的 OpenAI → Claude 格式转换。

---

## 请求示例

### cURL — 非流式

```bash
curl -X POST http://localhost:9527/v1/messages \
  -H "content-type: application/json" \
  -H "x-api-key: your-api-key" \
  -H "anthropic-version: 2023-06-01" \
  -d '{
    "model": "claude-sonnet-4-6",
    "max_tokens": 1024,
    "messages": [
      {"role": "user", "content": "Hello, how are you?"}
    ]
  }'
```

### cURL — 流式

```bash
curl -X POST http://localhost:9527/v1/messages \
  -H "content-type: application/json" \
  -H "x-api-key: your-api-key" \
  -H "anthropic-version: 2023-06-01" \
  -d '{
    "model": "claude-sonnet-4-6",
    "max_tokens": 1024,
    "stream": true,
    "messages": [
      {"role": "user", "content": "Hello, how are you?"}
    ]
  }'
```

### cURL — 带系统提示词和工具

```bash
curl -X POST http://localhost:9527/v1/messages \
  -H "content-type: application/json" \
  -H "x-api-key: your-api-key" \
  -H "anthropic-version: 2023-06-01" \
  -d '{
    "model": "claude-sonnet-4-6",
    "max_tokens": 1024,
    "system": "You are a helpful assistant that provides concise answers.",
    "tools": [
      {
        "name": "get_weather",
        "description": "Get the current weather in a location",
        "input_schema": {
          "type": "object",
          "properties": {
            "location": { "type": "string", "description": "City name" }
          },
          "required": ["location"]
        }
      }
    ],
    "messages": [
      {"role": "user", "content": "What is the weather in Tokyo?"}
    ]
  }'
```

### Python — 使用 Anthropic SDK

```python
from anthropic import Anthropic

client = Anthropic(
    api_key="your-api-key",  # 如果 Provider 配置了 api_key，这里可以填任意值
    base_url="http://localhost:9527"
)

message = client.messages.create(
    model="claude-sonnet-4-6",
    max_tokens=1024,
    messages=[
        {"role": "user", "content": "Hello, how are you?"}
    ]
)
print(message.content)
```

### Python — 流式

```python
from anthropic import Anthropic

client = Anthropic(
    api_key="your-api-key",
    base_url="http://localhost:9527"
)

with client.messages.stream(
    model="claude-sonnet-4-6",
    max_tokens=1024,
    messages=[
        {"role": "user", "content": "Tell me a story"}
    ]
) as stream:
    for text in stream.text_stream:
        print(text, end="", flush=True)
```

### Python — 使用 OpenAI SDK（OpenAI 兼容模式）

```python
from openai import OpenAI

client = OpenAI(
    api_key="your-api-key",  # Provider 配置了 api_key 时可填任意值
    base_url="http://localhost:9527/v1"  # 注意 /v1 后缀
)

response = client.chat.completions.create(
    model="claude-sonnet-4-6",
    max_tokens=1024,
    messages=[
        {"role": "user", "content": "Hello!"}
    ]
)
print(response.choices[0].message.content)
```

---

## 配置说明

### Proxy 配置

配置文件路径: `~/.cc-monitoring/config.json`

| 配置项 | 路径 | 默认值 | 说明 |
|---|---|---|---|
| 端口 | `server.port` | `9527` | 监听端口 |
| Host | `server.host` | `localhost` | 监听地址 |
| 上游地址 | `proxy.target` | — | 上游 API base URL |
| 上游 API Key | `proxy.apiKey` | — | 上游默认 API key |
| UI 认证 | `auth.token` | — | 管理 UI 访问令牌 |

### Provider 配置

Provider 存储在 SQLite 数据库（非 config.json），通过 UI 或 REST API 管理。

**管理 API：**

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/ui/api/providers` | 列出所有 Provider |
| POST | `/ui/api/providers` | 全量替换保存（需 auth） |

**Provider 字段：**

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `name` | `string` | 是 | 显示名称 |
| `provider` | `string` | 是 | 供应商标识（anthropic/openai/openrouter 等） |
| `base_url` | `string` | 否 | API base URL，覆盖 config.proxy.target |
| `api_key` | `string` | 否 | API key，覆盖 config.proxy.apiKey |
| `model` | `string` | 否 | 默认模型 |
| `haiku_model` | `string` | 否 | haiku tier 模型 |
| `sonnet_model` | `string` | 否 | sonnet tier 模型 |
| `opus_model` | `string` | 否 | opus tier 模型 |
| `subagent_model` | `string` | 否 | 子代理模型（预留） |
| `is_default` | `boolean` | 否 | 是否为默认 Provider（最多一个） |
| `is_openai_compatible` | `boolean` | 否 | 是否启用 OpenAI 兼容模式 |

---

## 超时与限制

| 项目 | 值 | 说明 |
|---|---|---|
| 请求超时 | 5 分钟（300,000ms） | 硬编码，不可配置 |
| 请求体大小 | Fastify 默认（1MB） | — |

---

## 常见问题

### Q: 不使用 Claude Code 客户端可以直接调 API 吗？
是的。Proxy 完全兼容 Anthropic Messages API，任何 HTTP 客户端都可以直接请求。

### Q: 需要传 API key 吗？
如果 Provider 配置了 `api_key`，Proxy 会自动替换/注入，客户端可以传任意值或不传。如果 Provider 未配置 `api_key`，客户端的 key 会被原样转发到上游。

### Q: 支持哪些模型？
取决于上游 Provider。请求中的 `model` 字段会按 tier 规则重写（haiku/sonnet/opus），具体重写目标由 Provider 配置决定。

### Q: OpenAI 兼容模式是什么？
当 Provider 标记 `is_openai_compatible: true`，Proxy 会在 Claude API 格式和 OpenAI API 格式之间自动转换。客户端始终发送 Claude 格式请求，Proxy 内部转为 OpenAI 格式发给上游，再将 OpenAI 响应转回 Claude 格式返回。

### Q: 如何查看请求日志？
访问 Proxy 的 Web UI（`http://localhost:9527`），可以看到所有请求的详细日志、token 用量统计等。

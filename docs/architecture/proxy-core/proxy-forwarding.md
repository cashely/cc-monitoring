# proxy-core / 代理转发（`/v1/*` 纯代理路径）

## 本文档覆盖的源文件

- `apps/proxy-core/src/server/proxy.ts:1-457`

> **注意**：`/v1/*` 现为纯代理路径，不做请求体修改（除 model tier rewrite）、不做 tool 注入、不做 mock 拦截。增强型代理路径 `/api/chat` 见 [chat-api.md](./chat-api.md)。

## 与 `/api/chat` 的分工

| 能力 | `/v1/*` | `/api/chat` |
|---|---|---|
| 请求体修改 | 仅 model tier rewrite | model rewrite + MCP tool 注入 |
| 响应处理 | 透传原样（JSON/SSE pipe） | SSE 流式转发 + inject loop 续接 |
| Session 管理 | 从 header 读 `x-claude-code-session-id` | 生成/复用 `x-chat-session-id`，支持 resume |
| Tool 注入 | 无 | `injectMcpTools`（MCP 动态 tool only） |
| Mock 拦截 | 无 | `shouldMock`（PoC 测试） |
| DB 记录 | 单条（原始请求） | 多条（原始 + 每次 loop 迭代独立记录） |

## 顶层结构

`setupProxy(fastify, proxyConfig)`（`proxy.ts:186-228`）注册一个 `fastify.all('/v1/*', ...)`。函数在服务启动时执行一次，主要做五件事：

1. `initDatabase()`
2. `mcpManager.init()`：初始化 MCP server 连接（seed config + connect enabled servers）
3. `preloadMachineId()`：预加载 machine ID
4. 启动 `aggregateStats` 定时器（5 分钟一次；启动时立即跑一次）
5. `fastify.addHook('onClose', ...)`：关服时 `clearInterval` + `mcpManager.close()` + `closeDatabase()`
6. 注册请求 handler

请求 handler 是本文的核心。

## 为什么不用 `@fastify/http-proxy`

Fastify 生态里有透明代理插件，但项目最早使用后遇到了矛盾：透明代理内部完全接管 request stream，任何试图读 body 的操作都会消耗 stream。而本项目要同时满足：

- 记录完整 payload（model / messages / tools / MCP 参数）
- 原样转发 SSE 流
- 未来扩展 Token 统计、鉴权、审计

HTTP stream 只能被消费一次，于是切到「应用层转发」：Fastify 让 body 先被解析成 JSON，业务代码用 `fetch()` 主动发起上游请求，响应体用 `Readable.fromWeb().pipe(reply.raw)` 转发。

## Handler 三分支（纯代理）

`/v1/*` 不注入 tool、不做 mock、不进入 inject loop——只做纯转发 + 记录。

```mermaid
flowchart TD
  START([POST/GET/... /v1/*]) --> RESOLVE[resolveProxyTarget]
  RESOLVE --> MODEL[getProxyModel tier rewrite]
  MODEL --> HEADER[extractSafeHeaders → filterForwardHeaders]
  HEADER --> DATA[组装 requestData + machineId]
  DATA --> LOG[cleanOldRequestsDB]

  LOG --> FETCH[fetch targetUrl]

  FETCH --> CT{content-type}
  CT -- application/json --> BR1["JSON 分支<br/>response.text() + reply.code().send()"]
  CT -- text/event-stream --> BR2["SSE pipe 分支<br/>Readable.fromWeb.pipe(reply.raw)<br/>边转发边解析 data: 行"]
  FETCH --> CATCH[catch → error 分支]

  BR1 --> SAVE[saveRequestDB + pushNewRequest]
  BR2 --> STREAM_END[on 'end' → save + push]
  CATCH --> PUSH_ERR[pushNewRequest(error record)]
  SAVE --> END([返回])
  STREAM_END --> END
  PUSH_ERR --> END_ERR([返回错误 JSON])
```

公用部分见下面 [公用步骤](#公用步骤)，三个分支分别见后续小节。

## 公用步骤

### `resolveProxyTarget(proxyConfig)`

`proxy.ts:40-88`。每次请求同步查一次 `providers WHERE is_default = 1 LIMIT 1`。better-sqlite3 是同步 API，单行 SELECT 微秒级，无需缓存。

策略：

- 起始值 = 从 `config.proxy.target` 解析出 `baseUrl` + `targetPath`，`apiKey = config.proxy.apiKey`
- 若激活的 provider 有 `base_url` 且非空 → 覆盖 baseUrl/targetPath
- 若 `api_key` 非空 → 覆盖 apiKey
- 若 `model / haiku_model / sonnet_model / opus_model` 非空 → 记入返回值（供 `getProxyModel` 按 tier 替换）
- 任何异常（DB 未初始化 / URL 解析失败）→ fallback 只用 config

返回 `{ baseUrl, targetPath, apiKey?, model?, haiku_model?, sonnet_model?, opus_model? }`。

### `getProxyModel(originalModel, tierModels)`

`proxy.ts:98-115`。根据请求的原始 model 和 provider tier 配置选择替换 model：

```ts
claude-haiku*   → haiku_model (fallback: model)
claude-sonnet*  → sonnet_model (fallback: model)
claude-opus*    → opus_model (fallback: model)
其它            → model
所有为空        → undefined (不替换)
```

例如：provider `sonnet_model = "glm-5.1"` → 请求 `model = "claude-sonnet-4-6"` 被改写为 `glm-5.1`。

### `extractSafeHeaders(headers)`

`proxy.ts:117-128`。Fastify 的 `request.headers` 是 `Record<string, unknown>`（值可能是 string[]），直接传给 `filterForwardHeaders` 会产生 circular reference 或类型问题。`extractSafeHeaders` 把所有值转为 `string`（数组 join `, `），生成干净的 `Record<string, string>`。

### 请求元数据组装

`proxy.ts:234-290`：

- `sessionId = headers['x-claude-code-session-id'] || 'unknown-session'`
- `getProxyModel(originalModel, resolved)` 替换 model（原地修改 `request.body.model`）
- `extractSafeHeaders(request.headers)` → `filterForwardHeaders(safeHeaders, resolved.apiKey)`：删 host/content-length/x-req-key；有 provider key 则覆盖 `x-api-key` 和 `authorization`
- 从 Authorization / x-api-key 头提取客户端原 apiKey；从 filtered 后的 headers 提取实际发给上游的 proxyApiKey
- `machineId = getMachineIdSync() ?? undefined`
- 组装 `RequestData`：request 部分立即填齐（含 machineId, baseUrl），response 部分先占位（`statusCode: 0, events: []`）

### 记录与清理

- `cleanOldRequestsDB(maxDays)`：每次请求都跑一次 DELETE（`maxDays=0` 时函数直接 return）
- `request.log.info(...)` 打印请求摘要

## 分支 1：JSON 响应

`proxy.ts:324-362`。当上游返回 `content-type: application/json`（通常是错误响应或非流式）：

- `const responseBody = await response.text()`
- 尝试 `JSON.parse(responseBody)`；成功则把整个 body 作为单一 event `push` 到 `events` 数组；失败则 push `{ raw: responseBody }`
- 更新 `requestData.response.statusCode / headers / completedAt`
- `saveRequestDB` 写库
- `extractTokenUsage` 提取 usage（从 events 中找 `type === 'message_delta'`）
- `pushNewRequest` 广播（含 machineId, baseUrl）
- `reply.code(response.status).headers(...).send(responseBody)` 原样返回给客户端

优点：完整错误信息进库，方便调试云端 429/401/500。

## 分支 2：SSE pipe（默认路径）

`proxy.ts:364-426`。零缓冲，纯转发：

```ts
reply.hijack()
reply.raw.writeHead(response.status, responseHeaders)
const nodeStream = Readable.fromWeb(response.body as any)

nodeStream.on('data', (chunk) => {
  // 边转发边解析 data: 行到 requestData.response.events
  // 管道转发：chunk → reply.raw（客户端实时收到）
  // 解析：提取 data: 行 JSON → push events[]
})
nodeStream.on('end', async () => {
  requestData.response.completedAt = new Date().toISOString()
  await saveRequestDB(...)
  pushNewRequest(...)  // 含 machineId, baseUrl
})
nodeStream.pipe(reply.raw)
```

- **Web ReadableStream → Node Readable**：`Readable.fromWeb()`（Node 18+ 提供）
- **数据事件双职责**：pipe 会把 chunk 转发出去，同时 handler 里手动解析 `data:` 前缀行提取 event（含 Anthropic 双行 `event:xxx\ndata:{...}` 格式）
- **保留原响应头**：不覆盖 content-type，客户端拿到的响应长得跟直连上游一样

### SSE 解析容错

`proxy.ts:412-427`：

```ts
const lines = text.split('\n')
for (const line of lines) {
  if (line.startsWith('data:')) {
    const eventData = line.slice(5).trim()
    if (eventData && eventData !== '[DONE]') {
      try { requestData.response.events.push(JSON.parse(eventData)) } catch {}
    }
  }
}
```

同时兼容标准 `data: {...}` 和阿里云的 `event:xxx\ndata:{...}` 双行格式（`event:` 行被忽略）。`[DONE]` 也跳过。

### chunk 边界问题

**已知边界**：如果一个 `data: {...}` 事件跨 chunk 被截断，当前实现会解析失败（`JSON.parse` 抛错被 catch 吞掉）。数据库里丢一条 event 但不影响客户端流转发。项目里另有 `SSEAccumulator`（`utils/sse-accumulator.ts`）是完整的 Transform 流，但在 `proxy.ts` 当前路径中**未启用**。

## 分支 3：Error

`proxy.ts:428-456`：

- 上游 `fetch` 抛错时命中
- `getErrorStatusCode`：`ECONNREFUSED` / `ENOTFOUND` → 502；`ETIMEDOUT` → 504；其它 → 500
- `getErrorMessage`：三选一或 `Proxy error`
- 仍然 `pushNewRequest` 一条含错误 statusCode 的记录（供面板显示红色徽章）
- 响应体：`{ error, requestId }` JSON

## 关键决策

- **纯代理设计**：`/v1/*` 不做任何请求体修改（除 model tier rewrite）、不注入 tool、不做 mock。所有增强逻辑放在 `/api/chat`。这让 `/v1/*` 成为零风险路径——客户端用它时 proxy 完全透明
- **`reply.hijack()` 的语义**：Fastify 停止管你，包括路由响应、日志钩子、`onSend` hook。之后你必须自己 `reply.raw.end()`，否则连接挂着
- **重新序列化 body**：`fetch` 的 body 用 `JSON.stringify(request.body)`。这意味着如果客户端发送的 JSON 有非语义变化（空格、字段顺序），代理会「格式化」它。对语义无影响，但会影响某些希望做 body hash 的场景
- **URL 拼接**：`targetUrlStr = baseUrl + targetPath + request.url`。例如 `baseUrl='https://ark.cn-beijing.volces.com'` + `targetPath='/api/coding'` + `request.url='/v1/messages'` = `https://ark.cn-beijing.volces.com/api/coding/v1/messages`。因此 provider 的 base_url 应写成含 API 前缀的形式
- **一次请求两次 `Date.now()`**：`startTime` 在 handler 入口；SSE 分支的 `elapsed` 在 `end` 事件；同步分支（JSON）在 `send` 前。都体现 handler 视角的耗时
- **Tier model fallback 链**：`getProxyModel` 按 tier 映射，每个 tier 优先用专属 model（`haiku_model / sonnet_model / opus_model`），无专属 model 时 fallback 到通用 `model`，再 fallback 到不替换

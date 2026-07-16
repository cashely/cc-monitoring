# proxy-cli / API 层

## 本文档覆盖的源文件

- `apps/proxy-cli/src/api/index.ts`
- `apps/proxy-cli/src/api/providers.ts`
- `apps/proxy-cli/src/api/mcp.ts`

前端与 proxy-core 唯一通信手段（除 WebSocket）就是这里的 REST 封装。全部用原生 `fetch`，无 axios。

## 常量

```ts
const API_BASE = '/ui/api'
```

所有端点都用相对路径 → 依赖 Vite dev proxy 或生产同源。

## `api/index.ts` — 主接口

### `fetchStatus`

```ts
GET /ui/api/status  →  StatusApiResponse
```

对应后端 `ui-route.ts:44-54`。

### `fetchStatusHistory(durationMs = 3600000)`

```ts
GET /ui/api/status/history?duration=<ms>  →  { history: StatusDataPoint[] }
```

默认 1 小时窗口。

### `fetchConfig`

```ts
GET /ui/api/config  →  { config, versions, configPath? }
```

`configPath` 是 `getConfigPath()` 的返回值，供 UI 显示当前用哪份 config。

### `saveConfig(config, reload = false)`

```ts
POST /ui/api/config
Body: { ...configFields, reload }
→ { success, errors?, reloaded?, restartingIn? }
```

若 `reload: true` 且 PM2 状态 online，后端会 `setTimeout(5000, reloadProcess)` 延迟重启。

### `fetchRequests(limit = 1000)`

```ts
GET /ui/api/requests?limit=<n>  →  { requests: RequestSummary[] }
```

### `controlProcess(action)`

```ts
POST /ui/api/control
Body: { action: 'start' | 'stop' | 'restart' }
→ { success, error? }
```

`restart` 后端延迟 1s 重启，同步返回 `restartingIn: 1000`。

### `fetchStats`

```ts
GET /ui/api/stats  →  StatsData
```

预聚合数据（24h hourly + 30d daily + lastUpdated）。

### `fetchTodayStats`

```ts
GET /ui/api/stats/today?since=<local midnight ISO>  →  TodayStats
```

关键实现：

```ts
const midnight = new Date()
midnight.setHours(0, 0, 0, 0)
const res = await fetch(`${API_BASE}/stats/today?since=${encodeURIComponent(midnight.toISOString())}`)
```

**浏览器本地零点** → toISOString 转 UTC 后传给后端。这样「今日」边界随用户时区，与后端预聚合 daily 的硬编码 +8 无关。

### 转发导出

```ts
export { fetchProviders, saveProviders } from './providers'
export { fetchMcpServers, createMcpServer, updateMcpServer, deleteMcpServer, reconnectMcpServer, fetchMcpTools } from './mcp'
```

## `api/mcp.ts` — MCP Server 管理接口

### `fetchMcpServers`

```ts
GET /ui/api/mcp/servers  →  { servers: McpServerWithStatus[] }
```

每个 server 包含实时连接状态（connected/disconnected/connecting/not_connected/disabled）和 toolCount。

### `createMcpServer(server: McpServerInput)`

```ts
POST /ui/api/mcp/servers
Body: { server: McpServerInput }
→ { success: boolean, server?: McpServerWithStatus, error?: string }
```

认证 required。McpServerInput 含 name, transport_type (stdio/sse/streamable-http), command, args, env, url, headers, enabled。

### `updateMcpServer(id, input)`

```ts
PATCH /ui/api/mcp/servers/:id
Body: Partial<McpServerInput>
→ { success: boolean, server?: McpServerWithStatus, error?: string }
```

认证 required。更新后触发 mcpManager.reconnectServer。

### `deleteMcpServer(id)`

```ts
DELETE /ui/api/mcp/servers/:id  →  { success: boolean, error?: string }
```

认证 required。先 disconnect 再清 DB。

### `reconnectMcpServer(id)`

```ts
POST /ui/api/mcp/servers/:id/reconnect  →  { success: boolean, error?: string }
```

认证 required。手动重建连接。

### `fetchMcpTools`

```ts
GET /ui/api/mcp/tools  →  { tools: McpTool[] }
```

列出所有已发现 MCP tool（name + description + input_schema）。

## `api/providers.ts` — 供应商接口

### `fetchProviders`

```ts
GET /ui/api/providers  →  { providers: Provider[] }
```

无认证。

### `saveProviders(providers)`

```ts
POST /ui/api/providers
Body: { providers: ProviderInput[] }
→ ProviderSaveResult { success, errors?, error? }
```

Destructive 全量替换。写接口，需要 Bearer 认证（但目前前端**未发送 Authorization 头**——只在后端未配置 `auth.token` 时可用）。

## 特点

- **无统一 wrapper**：每个函数各自 `await res.json()` 返回，没有拦截器、没有错误转换。调用方自己判断 `success / error` 字段
- **无重试**：网络失败直接 reject
- **无 abort signal**：request cancel 未实现（React StrictMode 双渲染时可能产生重复请求，`useConfig` 里通过 `useEffect` 空依赖数组避免）
- **认证缺失**：`saveConfig / saveProviders / controlProcess` 都是写接口，但前端不发 `Authorization` 头。生产环境启用 `auth.token` 后这些接口会 401。修复方案：加拦截器或在函数签名里传 token 参数

## 与 WebSocket 的分工

| 数据 | REST 端点 | WebSocket 消息 |
|---|---|---|
| 状态快照 | GET `/ui/api/status` | `type=status action=snapshot`（每 10s） |
| 状态历史 | GET `/ui/api/status/history` | 在 `status` 消息的 `data.history` 中 |
| 请求摘要 | GET `/ui/api/requests` | `type=request action=new`（每次新请求推送） |
| 请求详情 | GET `/ui/api/requests/:id` | 无（懒加载） |
| stats 汇总 | GET `/ui/api/stats` | `type=stats action=notify` → 触发主动 GET |
| 今日实时 | GET `/ui/api/stats/today` | `request` 消息到达时主动 GET |
| 配置 | GET/POST `/ui/api/config` | 无 |
| 供应商 | GET/POST `/ui/api/providers` | 无 |
| MCP servers | GET/POST/PATCH/DELETE `/ui/api/mcp/servers` | 无 |
| MCP tools | GET `/ui/api/mcp/tools` | 无 |
| 进程控制 | POST `/ui/api/control` | 无 |
| 日志 | 无 | `/ui/api/logs/stream` 专用通道 |

REST 用于**冷启动 + 请求详情懒加载 + 写操作**；WebSocket 用于**订阅式增量推送**。

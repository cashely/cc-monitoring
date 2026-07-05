# proxy-cli / 工具与 i18n

## 本文档覆盖的源文件

- `apps/proxy-cli/src/utils/parse-events.ts`
- `apps/proxy-cli/src/utils/format-time.ts`
- `apps/proxy-cli/src/utils/format-number.ts`
- `apps/proxy-cli/src/i18n/index.ts`
- `apps/proxy-cli/src/i18n/locales/{zh,en}/*.json`
- `apps/proxy-cli/src/types/*.ts`

## utils/parse-events

`apps/proxy-cli/src/utils/parse-events.ts`。SSE events → `ParsedResponse`：

```ts
export interface ParsedResponse {
  thinking?: string
  text?: string
  toolCalls?: Array<{ name: string; id: string; input: Record<string, any> }>
  usage: { inputTokens: number; outputTokens: number; cacheReadTokens?: number }
  stopReason: string
}
```

已在 [components-requests.md](./components-requests.md#parse-events) 详述。

**要点**：

- 用 `Map<index, block>` 累积 delta（`content_block_delta` 按 index 追加）
- 三种 delta 类型：`thinking_delta / input_json_delta / text_delta` 分别累加到 `block.content` 同一字段（前端解析器不区分 thinking/text 的字段名，靠 block.type 分类）
- `parseToolInput(content)` 尝试 JSON.parse `tool_use` 的 input；失败降级 `{ _raw: content }` 保留原始内容

**与后端 `inject-loop.ts` 的对比**：前者返回 UI 展示所需的**扁平字段**（thinking / text / toolCalls），后者返回**有序 blocks 数组**用于 API 转发。

## utils/format-time

`apps/proxy-cli/src/utils/format-time.ts`：

```ts
export type TimeFormat = 'datetime' | 'date' | 'time' | 'monthDayTime'

export function formatTime(input: string | number | null | undefined, format: TimeFormat = 'datetime'): string
```

四种格式：

| format | 输出示例 | Intl 选项 |
|---|---|---|
| `datetime` | `2026/07/04 08:15:30` | 默认 `toLocaleString()` |
| `date` | `2026/07/04` | year+month+day |
| `time` | `08:15` | hour+minute |
| `monthDayTime` | `07/04 08:15:30` | month+day+hour+min+sec |

- **本地时区**：`toLocaleString('zh-CN', options)` 用浏览器时区
- **空值/非法**：返回 `'--'`（不抛错、不显示 `Invalid Date`）
- **接受 string / number / null / undefined**：`new Date(input)` 兼容 ISO 串和 Unix ms

## utils/format-number

`apps/proxy-cli/src/utils/format-number.ts`：

```ts
const COMPACT_FORMATTER = Intl.NumberFormat('en-US', {
  notation: 'compact',
  compactDisplay: 'short'
})

export function formatCompactNumber(num: number): string {
  return COMPACT_FORMATTER.format(num)
}
```

用于图表 Y 轴 tick：`1234 → 1.2K / 1234567 → 1.2M`。使用 `en-US` 保证是 K/M/B 而非中文的「万/亿」。

## i18n

见 [app-shell.md](./app-shell.md#i18nindexts--多语言初始化)。

### 6 命名空间职责

- **common**（默认）：全站按钮、公用文案
  - `action.restart / restarting / close ...`
  - `label.address / label.configPath ...`
- **app**：主布局 + Token + 连接状态 + 请求相关
  - `title / hourly / daily / inputTokens / outputTokens / cacheTokens / lastUpdated`
  - `today.inputTokens / today.outputTokens / today.cacheTokens / today.requestCount / today.models / today.noModels`
  - `requests.loading / empty / compare / compareTitle / compareClose / compareLeft / compareRight / compareLoadFailed`
  - `versions.claudeCode / versions.project`
  - `connection.disconnected`
- **status**：状态面板文案
  - `cpuChart / memoryChart`
- **log**：日志相关（当前 UI 未主用）
- **config**：配置编辑器
  - `heading / section.server / action.manageProviders / action.restartServer`
  - `message.restarting / savedAndReloaded / restartTimeout`
- **providers**：供应商弹窗
  - `heading / confirmDelete`
  - `label.{name,baseUrl,apiKey,model,haikuModel,sonnetModel,opusModel,subagentModel,provider,action}`
  - `action.{add,save,saving,close,activate,activated,delete}`
  - `error.fieldMessage`（`第 {{row}} 行: {{field}} - {{message}}`）
  - `message.savedSuccess / networkError`

### 语言侦测优先级

1. `localStorage['i18nextLng']`（用户之前切过）
2. `navigator.language`
3. `fallbackLng: 'zh'`

切换后写回 localStorage 保持一致。

## Types 目录

`apps/proxy-cli/src/types/index.ts` 是 barrel：

```ts
export * from './config'
export * from './log'
export * from './request'
export * from './status'
export * from './stats'
export * from './version'
export * from './providers'
```

### types/config.ts

```ts
export interface AppConfig { server, proxy, logging, auth? }
```

前端**接收**的配置形状（`fetchConfig` 返回）。与后端 Zod `AppConfig` 字段一致但**不包含 storage** —— 前端目前不展示存储配置字段。

### types/request.ts

```ts
export interface TokenUsage { input_tokens?, output_tokens?, cache_read_input_tokens?, cache_creation_input_tokens? }
export interface RequestSummary { requestId, sessionId, compositeId, timestamp, method, path, statusCode, responseTime, model?, usage? }
export interface RequestDetails { requestId, request: { method, path, headers, body? }, response?: { statusCode, headers?, events?, completedAt?, closedAt?, error?, usage? } }
```

注意 `TokenUsage` 在文件里**重复声明了两次**（第 1-6 行与 21-26 行）——TS 允许重复的相同接口声明，等价于一次。历史遗留。

### types/status.ts

```ts
export type ProcessStatus = 'online' | 'stopped' | 'errored' | 'launching'
export interface StatusApiResponse { status: ProcessStatus, cpu, memory, uptime, restarts }
export interface StatusDataPoint { timestamp: number, cpu: number, memory: number }
export interface StatusHistoryResponse { history: StatusDataPoint[] }
export interface ValidationError { field: string, message: string }
```

### types/stats.ts

```ts
export interface TokenUsage { input_tokens, output_tokens, cache_read_input_tokens }
export interface StatsData { hourly: Record<string, TokenUsage>, daily: Record<string, TokenUsage>, lastUpdated: string | null }
export interface TodayStats { input_tokens, output_tokens, cache_read_tokens, request_count, models: Record<string, number> }
```

`TokenUsage` 与 `types/request.ts` 同名不同结构：`stats.ts` 版本**无 cache_creation_input_tokens** —— stats 只汇总 input/output/cacheRead 三项。

### types/log.ts

```ts
export interface LogEntry { level, time, requestId, method, path, auth, msg, error? }
export type RequestSummaryType = 'request_started' | 'request_completed'
export interface RequestSummaryEntry { type, requestId, method, path, level, statusCode?, responseTime?, error? }
export type LogItem = LogEntry | RequestSummaryEntry
export function isRequestSummary(entry): entry is RequestSummaryEntry
```

联合类型 + 类型守卫。`useLogs` 里判断消息种类用 `REQUEST_SUMMARY_TYPES` set。

### types/providers.ts

见 [components-config.md](./components-config.md#类型)。

### types/version.ts

```ts
export interface VersionInfo { projectVersion: string; claudeVersion: string }
```

## 相关

- 数据消费 → [data-hooks.md](./data-hooks.md)
- 后端相关类型 → [../proxy-core/utilities.md](../proxy-core/utilities.md#类型定义types)

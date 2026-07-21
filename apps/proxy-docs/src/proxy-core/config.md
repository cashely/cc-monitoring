# proxy-core / 配置与日志

## 本文档覆盖的源文件

- `apps/proxy-core/src/config/schema.ts`
- `apps/proxy-core/src/config/index.ts`
- `apps/proxy-core/src/logger/index.ts`
- `apps/proxy-core/src/types/config.ts` / `log.ts`

## Zod Schema

`apps/proxy-core/src/config/schema.ts:3-29`：

```ts
export const AppConfigSchema = z.object({
  server: z.object({
    port: z.number().int().min(1).max(65535),
    host: z.string().min(1)
  }),
  proxy: z.object({
    target: z.string().url(),
    changeOrigin: z.boolean(),
    rewritePrefix: z.string().optional(),
    apiKey: z.string().min(1).optional()
  }),
  logging: z.object({
    level: z.enum(['debug', 'info', 'warn', 'error']),
    file: z.string().min(1),
    maxSize: z.string().default('10m'),
    interval: z.string().default('1d'),
    compress: z.boolean().default(true)
  }),
  storage: z.object({
    type: z.enum(['sqlite']).default('sqlite'),
    path: z.string().min(1).default('logs/proxy.db'),
    maxDays: z.number().int().min(0).default(7)
  }).optional().default({ type: 'sqlite', path: 'logs/proxy.db', maxDays: 7 }),
  auth: z.object({
    token: z.string().min(1)
  }).optional()
})

export function validateConfig(config: unknown): ValidationResult { ... }
```

### 字段说明

| 段 | 字段 | 必填 | 默认 | 备注 |
|---|---|---|---|---|
| server | port | ✔ | — | 1..65535 |
| server | host | ✔ | — | 空串会拒 |
| proxy | target | ✔ | — | 必须合法 URL |
| proxy | changeOrigin | ✔ | — | 实际上目前**未使用**（应用层 fetch 无 `changeOrigin` 概念，代码里不读它） |
| proxy | rewritePrefix | ✖ | — | 目前**未使用**，早期透明代理遗留 |
| proxy | apiKey | ✖ | — | 若设置，替换客户端 `x-api-key` / `Authorization` 发给上游 |
| logging | level | ✔ | — | Pino level 枚举 |
| logging | file | ✔ | — | 相对路径按 config 所在目录解析 |
| logging | maxSize | ✖ | `'10m'` | file-stream-rotator 参数 |
| logging | interval | ✖ | `'1d'` | rotator 参数（当前代码固定用 `frequency: 'daily'`） |
| logging | compress | ✖ | `true` | rotator 参数（当前代码没启用 gzip） |
| storage | type | ✖ | `'sqlite'` | 只有 sqlite 一个选项 |
| storage | path | ✖ | `'logs/proxy.db'` | 相对路径按 config 目录解析 |
| storage | maxDays | ✖ | 7 | 0 或负数 = 不清理 |
| auth | token | ✖ | — | 非空字符串；未配置时不校验 |

### 校验入口

`validateConfig(config)`（`schema.ts:33-45`）返回 `{ valid: true, data }` 或 `{ valid: false, errors: [{field, message}] }`。

## 配置加载

`apps/proxy-core/src/config/index.ts:7-33`：

```ts
export async function loadConfig(configPath = getConfigPath()): Promise<AppConfig> {
  if (!fsSync.existsSync(configPath)) {
    ensureDataDirs()
    await resetConfig(configPath)   // 首次运行自动写默认
  }
  const content = await fs.readFile(configPath, 'utf-8')
  const raw = JSON.parse(content)
  const result = validateConfig(raw)
  if (!result.valid) throw new ConfigError(...)

  const configDir = path.dirname(configPath)
  const config = result.data!
  if (config.logging.file && !path.isAbsolute(config.logging.file)) {
    config.logging.file = path.resolve(configDir, config.logging.file)
  }
  if (config.storage?.path && !path.isAbsolute(config.storage.path)) {
    config.storage.path = path.resolve(configDir, config.storage.path)
  }
  return config
}
```

- **首次自动初始化**：文件不存在 → `ensureDataDirs`（建 `~/.cc-monitoring/logs`） + `resetConfig`（写默认）
- **相对路径归一化**：`logging.file` 和 `storage.path` 未绝对路径时，以 config 文件所在目录为基准解析。这让「移动 config 到别处 → 相关文件也跟着走」的行为直觉
- **校验失败即抛**：不 fallback，服务不启动

### 默认配置

`config/index.ts:43-64`：

```ts
{
  server: { port: 9527, host: 'localhost' },
  proxy: {
    target: 'https://ark.cn-beijing.volces.com/api/coding',
    changeOrigin: true
  },
  logging: { level: 'info', file: 'logs/proxy.log', maxSize: '10m', interval: '1d', compress: true },
  storage: { type: 'sqlite', path: 'logs/proxy.db', maxDays: 7 }
}
```

（`host: 'localhost'`——但仓库根 `config.json` 是 `0.0.0.0`，这是用户手动改的。）

### 保存与重置

- `saveConfig(config, path?)`：先 `validateConfig` 再 `fs.writeFile`（`JSON.stringify(..., 2)` 缩进两格）
- `resetConfig(path?)`：`saveConfig(defaultConfig, path)` 覆盖当前文件
- `ConfigError`：自定义 Error 子类，`name = 'ConfigError'`

## Logger

`apps/proxy-core/src/logger/index.ts:25-68`：

```ts
export function createLogger(config: LogConfig): pino.Logger {
  fs.mkdirSync(path.dirname(config.file), { recursive: true })

  const patternFilename = path.join(dirname, `${basename}-%DATE%.log`)
  const rotatingStream = rotator.getStream({
    filename: patternFilename,
    frequency: 'daily',
    date_format: 'YYYY-MM-DD',
    size: config.maxSize || '10m'
  })

  const dualStream = {
    write: (data: string) => {
      rotatingStream.write(data)
      try {
        const log = JSON.parse(data)
        console.log(`[${time}] ${coloredLevel} (${pid}): ${cyan(msg)}${formatBindings(log)}`)
      } catch {
        console.log(data)
      }
    }
  }

  return pino({ level: config.level, timestamp: pino.stdTimeFunctions.isoTime }, dualStream)
}
```

**双输出机制**：把 `dualStream` 传给 pino 作为唯一 sink。每条日志同时进两个 destination：

- 轮转文件（`file-stream-rotator` 按天切分 `proxy-YYYY-MM-DD.log`；size 超过 10m 也切）
- 终端 console（重新解析 JSON 后带 ANSI 颜色美化输出）

**颜色映射**（`levelColor`）：

- trace → 紫
- debug → 青
- info → 绿
- warn → 黄
- error → 红
- fatal → 红底白字

**msg 用青色**。`formatBindings` 单独把 `reqId / req / res / responseTime` 从 log 对象中挑出来另起一行显示，避免与主消息挤在一起。

### 只有 `frequency: 'daily'`

尽管 schema 允许 `interval` 配置，代码里目前**硬编码** `frequency: 'daily'`，`config.logging.interval` 只有默认值 `'1d'` 才与实际行为一致。改成小时/其它需修改 `createLogger`。

### 无 gzip 压缩

`config.logging.compress` 是 schema 里的字段，但 `rotator.getStream` 调用未传对应参数——目前不启用压缩。

## `readLogs`

`logger/index.ts:96-133`：CLI `logs` 命令使用。

- 读整个 `filePath` → split lines
- 按 `options.level`（把用户传的 `'info'` 等映射到 `pino` 的数值 level 30）过滤
- 按 `options.grep` 做大小写不敏感 substring 匹配
- 按 `options.limit` 截尾（保留最新 N 行）

一次性读整个文件，日志膨胀到几十 MB 时会占内存；日常运维（默认 50 行）无感。

## Fastify 集成

`server/index.ts:17-21`：

```ts
const fastify = Fastify({
  logger: logger as unknown as FastifyBaseLogger,
  trustProxy: true
})
```

`FastifyBaseLogger` 与 `pino.Logger` 类型定义有差异，`as unknown as` 强转（`server/index.ts:5-6` 也导入了 `FastifyBaseLogger`）。所有 `request.log.info(...)` 都最终进 pino 的 dualStream。

## 类型

`src/types/config.ts` 单独定义了 `ServerConfig / ProxyConfig / LogConfig / StorageConfig / AuthConfig`（供其它文件 import，不是 Zod 推导）。Zod 的 `AppConfig` 是主类型；`types/config.ts` 的等价接口是**冗余定义**，历史遗留（Zod 加入前）。

`src/types/log.ts` 定义面向前端的日志形状（`LogEntry / RequestSummaryEntry / LogItem`），不是本文的重点，见 [../proxy-cli/utils-and-i18n.md](../proxy-cli/utils-and-i18n)。

# proxy-core / 公共工具

## 本文档覆盖的源文件

- `apps/proxy-core/src/utils/paths.ts`
- `apps/proxy-core/src/utils/esm-dirname.ts`
- `apps/proxy-core/src/utils/net.ts`
- `apps/proxy-core/src/utils/version.ts`
- `apps/proxy-core/src/utils/sse-accumulator.ts`
- `apps/proxy-core/src/server/auth.ts`
- `apps/proxy-core/src/server/middleware/request-id.ts`
- `apps/proxy-core/src/types/*.ts`

## `paths.ts` — 数据目录锚点

`apps/proxy-core/src/utils/paths.ts`：

```ts
export const dataDir = path.join(os.homedir(), '.cc-monitoring')
export const logsDir = path.join(dataDir, 'logs')

let configPathOverride: string | null = null
export function setConfigPathOverride(absPath: string): void
export function getConfigPath(): string {
  return configPathOverride
    || process.env.CONFIG_PATH
    || path.join(dataDir, 'config.json')
}
export function ensureDataDirs(): void
```

**为什么锚定 `$HOME/.cc-monitoring`**：全局 npm/pnpm 安装后 `process.cwd()` 是用户当前目录（任意），PM2 fork 后 cwd 由 ecosystem 决定；只有主目录相对稳定。所有 config/log/db 都放这里，跨启动方式一致。

**config 路径优先级**：`--config <path>` CLI 参数 > `CONFIG_PATH` 环境变量 > 默认 `$HOME/.cc-monitoring/config.json`。三层策略给 CI/多环境部署留出口子。

`ensureDataDirs`：首次运行时 `mkdirSync(logsDir, { recursive: true })`——由 `loadConfig` 在文件缺失时调用（`config/index.ts:10`）。

## `esm-dirname.ts` — ESM/CJS 双模 __dirname

详见 [pm2.md](./pm2.md#esm-__dirname-替代-esm-dirnamets)。三个导出：

- `utilsDirname`：本文件目录（编译后 `dist/utils/`）
- `getCallerDirname(relativePath)`：相对本文件算出调用方目录
- `getCurrentModuleUrl()`：包装 `import.meta.url`

`__mocks__/esm-dirname.ts` 在 ts-jest CJS 环境下替换整个模块，避免语法错误。

## `net.ts` — 端口探测

`apps/proxy-core/src/utils/net.ts`：

```ts
function tryConnect(host, port, timeout = 1000): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port })
    // connect / timeout / error 都 destroy + resolve
  })
}

export async function waitForPort(host, port, onAttempt?): Promise<boolean> {
  const target = !host || host === '0.0.0.0' || host === '::' ? '127.0.0.1' : host
  for (let attempt = 1; attempt <= 5; attempt++) {
    await sleep(attempt * 1000)   // 1s + 2s + 3s + 4s + 5s = 15s
    onAttempt?.(attempt, 5)
    if (await tryConnect(target, port)) return true
  }
  return false
}
```

- **递增退避**：而非固定间隔，让服务启动慢时也能等到
- **0.0.0.0 → 127.0.0.1**：`0.0.0.0` 是监听通配符，连接需要具体 IP
- **回调**：`onAttempt` 让 CLI 用 ora spinner 显示 `Verifying port host:port (attempt X/5)`

**唯一调用点**：`start.ts` 和 `reload.ts` 的最后一步端口探测。

## `version.ts` — 版本信息

`apps/proxy-core/src/utils/version.ts`。三个导出：

### `getProjectVersion()`

从**本包自身**的 `package.json` 读取 `version`：

```ts
const pkgPath = path.join(getCallerDirname('../..'), 'package.json')
```

`../..` 相对 `utils/`，即 `apps/proxy-core/`。用 `getCallerDirname` 避免依赖 cwd。

### `getClaudeVersion()`

三级 fallback 找 Claude Code CLI 版本：

1. `execSync('claude --version')`（最可靠，跨平台，超时 5s）
2. `execSync('npm root -g')` 拿到全局 root → `<root>/@anthropic-ai/claude-code/package.json`
3. 硬编码常见路径遍历（macOS npm、Windows npm、pnpm 全局）——`*` 通配处 `readdirSync` 展开

任何步骤失败进下一步。全部失败返回 `'not installed'`。

**PM2 环境的坑**：PM2 fork 子进程继承 `PATH` 需要 shell 环境已导出，如果 PM2 daemon 是别的 shell 启动的，`claude` 命令可能找不到。注释里提到 `如果版本信息不正确，执行 pm2 kill 后重启`。

### `getVersionInfo()`

合并返回 `{ projectVersion, claudeVersion }`，被 `/ui/api/config` 端点使用（`ui-route.ts:63`）。

## `sse-accumulator.ts` — Transform 流形式的 SSE 解析

`apps/proxy-core/src/utils/sse-accumulator.ts`：

```ts
export class SSEAccumulator extends Transform {
  events: unknown[] = []
  private leftover: string = ''

  _transform(chunk, enc, cb) {
    const text = this.leftover + chunk.toString('utf-8')
    const lines = text.split('\n')
    this.leftover = lines.pop() || ''   // 保留末尾不完整行
    for (const line of lines) {
      if (line.startsWith('data: ')) {
        try { this.events.push(JSON.parse(line.slice(6))) }
        catch { this.events.push({ raw: line.slice(6) }) }
      }
    }
    this.push(chunk)   // 转发原样 chunk
    cb()
  }

  _flush(cb) { /* 处理 leftover */ }
}
```

**特点**：

- 处理 chunk 边界：不完整的最后一行留到下个 chunk
- `push(chunk)` 保证下游 pipe 拿到原始字节（相当于 SSE tap）
- `data: ` 后有空格（vs `sse-writer` 的 `data:` 无空格）——反映标准 SSE 与 Anthropic 变体的差异

**目前未被使用**：`proxy.ts` 的常规 SSE pipe 分支（`proxy.ts:404-457`）直接手写 `on('data')` 解析，`SSEAccumulator` 是**预留组件**，等未来重构或需要更严谨解析时启用。

## `server/auth.ts` — Bearer Token 校验

```ts
export const AUTH_TOKEN_ENV = 'UI_AUTH_TOKEN'

export function checkAuth(request, config): boolean {
  const token = config?.auth?.token || process.env[AUTH_TOKEN_ENV]
  if (!token) return true   // 未配置 → 完全放行（开发模式）

  const authHeader = request.headers?.authorization
  if (!authHeader) return false

  const provided = authHeader.startsWith('Bearer ')
    ? authHeader.slice(7)
    : authHeader
  return provided === token
}
```

- **触发点**：`POST /ui/api/config`、`POST /ui/api/control`、`POST /ui/api/providers` 三个写接口
- **优先级**：`config.auth.token` > 环境变量 `UI_AUTH_TOKEN`
- **两种头格式**：接受 `Bearer <token>` 和裸 `<token>`
- **恒等对比**：`===` 字符串对比（非常量时间——如果需要防时序攻击应换成 `crypto.timingSafeEqual`）

## `middleware/request-id.ts`

```ts
export const requestIdMiddleware = async (fastify) => {
  fastify.addHook('onRequest', async (request) => {
    const headerId = request.headers['x-request-id'] as string | undefined
    request.id = headerId || nanoid(12)
  })
}
```

Fastify plugin。在 `server/index.ts:23` 最先注册。

- **客户端可指定**：若请求头带 `x-request-id`，用它作为 `request.id`，方便跨系统链路追踪
- **否则生成 12 位 nanoid**：短、URL-safe、碰撞概率对本项目量级足够
- **`request.id` 覆盖 Fastify 默认**：Fastify 默认自己生成一个 request-id，本 hook 提前覆盖它

日志里的 `reqId` 字段就来自这个 `request.id`。

## 类型定义（`types/`）

- `types/api.ts`：REST 响应类型（例如 `{ success, error, errors[] }`），供 route handler 引用
- `types/config.ts`：Zod schema 的等价 TS 接口（冗余定义，历史遗留）
- `types/log.ts`：Pino level 相关类型
- `types/pm2.ts`：`Pm2ProcessStatus` 简化壳（`{ name, status, cpu, memory, uptime, restarts }`），`getProcessStatus` 的返回类型
- `types/index.ts`：barrel 转发

其中 `types/config.ts` 与 `config/schema.ts` 定义重叠。**主类型**是 Zod 推导的 `AppConfig`（`schema.ts:31`）；`types/config.ts` 的接口用于 pino 传入等非 Zod 依赖场景。

## 相关文档

- 启动链 → [entry.md](./entry.md)
- PM2 集成 → [pm2.md](./pm2.md)
- Zod schema → [config.md](./config.md)

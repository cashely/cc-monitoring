# 01. 快速上手

## 本文档覆盖的源文件

- `package.json`（根 scripts）
- `apps/proxy-core/package.json`
- `apps/proxy-core/src/cli/index.ts:15-80`
- `apps/proxy-core/src/utils/paths.ts`
- `apps/proxy-core/ecosystem.config.cjs`
- `apps/proxy-cli/vite.config.ts`
- `apps/proxy-admin/vite.config.ts`
- `apps/proxy-admin/src/vite-env.d.ts`

## 环境要求

- **Node.js** ≥ 18
- **pnpm** ≥ 8
- macOS / Linux / Windows（PM2 fork 模式跨平台）

## 首次安装

```bash
pnpm install         # 安装 monorepo 全部依赖
pnpm build           # 构建三个应用
pnpm start           # PM2 守护启动代理服务器
```

启动脚本对应 `apps/proxy-core/dist/cli/index.js start`。首次运行会自动在数据目录写入默认 `config.json`（见下节）。

## 数据目录约定

所有运行时数据统一在 `~/.cc-monitoring/`（`apps/proxy-core/src/utils/paths.ts:7`）：

```
~/.cc-monitoring/
├── config.json          # 运行时配置（缺省则用默认值写入）
└── logs/
    ├── proxy.log        # Pino 主日志
    ├── proxy-YYYY-MM-DD.log  # 按日轮转
    ├── error.log        # PM2 错误日志
    ├── out.log          # PM2 输出日志
    └── proxy.db         # SQLite 数据文件
```

优先级（`getConfigPath()` in `paths.ts:18-20`）：

1. `--config <path>` CLI 参数（`src/cli/index.ts:19-25` 通过 `preAction` 钩子写入 override）
2. `CONFIG_PATH` 环境变量
3. `~/.cc-monitoring/config.json` 默认

## 端口约定

| 服务 | 默认端口 | 来源 |
|---|---|---|
| proxy-core（生产） | 9527 | `~/.cc-monitoring/config.json` 的 `server.port` |
| proxy-cli（开发） | Vite 默认 | `apps/proxy-cli/vite.config.ts`，`/ui/api` 反代到 `http://localhost:3000` |
| proxy-admin（开发） | 3000 | `apps/proxy-admin/vite.config.ts:21` |

⚠️ proxy-admin 开发端口 3000 与 proxy-cli 早期反代目标一致；同时开发时需修改二者之一避免冲突。

## 根级便捷命令

`package.json` 提供的 script 会转发到 proxy-core CLI：

```bash
pnpm start                # 启动 (PM2)
pnpm stop                 # 停止
pnpm status               # 状态
pnpm reload               # 优雅重启
pnpm logs [N]             # 查看最近 N 行日志
pnpm config               # 显示当前配置
pnpm test-connection      # 探测上游连通性
pnpm ui                   # 浏览器打开 http://localhost:9527/ui
pnpm cli --help           # 全部 CLI 命令
```

分应用命令：

```bash
pnpm dev:proxy-core       # tsx 热重载运行 Fastify
pnpm dev:proxy-cli        # Vite HMR 运行 proxy-cli
pnpm dev:proxy-admin      # Vite HMR 运行 proxy-admin
pnpm dev                  # 只启 proxy-core dev（根 script 别名）
pnpm build                # 全量构建（pnpm -r build）
pnpm build:proxy-core     # 单独构建 proxy-core
pnpm build:proxy-cli
pnpm build:proxy-admin
pnpm test                 # 全量测试（pnpm -r test）
```

## CLI 命令速查

（详见 [proxy-core/cli-commands.md](./proxy-core/cli-commands.md)）

| 命令 | 作用 | 常用参数 |
|---|---|---|
| `start` | PM2 守护启动 | `-p, --port <port>` 覆盖配置端口 |
| `stop` | 停止进程 | — |
| `status` | 状态（CPU/内存/uptime/重启次数） | — |
| `reload` | 优雅重启，探测 online + 端口 | — |
| `logs [n]` | 打印最近 n 行日志 | `-l level`、`-g pattern` |
| `config` | show / set / reset | `config set proxy.target <url>` |
| `test` | HEAD 探测上游 | — |
| `ui` | 打开面板 | `--build` 强制重建 UI |
| `clean-requests` | 清理旧请求记录 | `--days 7` |

全局参数：`-c, --config <path>` 覆盖配置文件路径。

## 配置文件

启动时 Zod 校验（`apps/proxy-core/src/config/schema.ts`），字段结构：

```json
{
  "server":  { "port": 9527, "host": "0.0.0.0" },
  "proxy":   { "target": "https://ark.cn-beijing.volces.com/api/coding", "changeOrigin": true, "apiKey": "sk-..." },
  "logging": { "level": "info", "file": "logs/proxy.log", "maxSize": "10m", "interval": "1d", "compress": true },
  "storage": { "type": "sqlite", "path": "logs/proxy.db", "maxDays": 7 },
  "auth":    { "token": "..." }
}
```

> `logging.file` 和 `storage.path` 中 `logs/` 是**相对于 config 所在目录**的路径，实际存储在 `~/.cc-monitoring/logs/` 下，项目根目录不含这些文件。

- `logging.file` 和 `storage.path` 是相对路径时，以 config 所在目录为基准解析（`config/index.ts:23-30`）
- `storage.maxDays = 0` 表示保留全部历史（`request-writer.ts:189-193`）
- `auth.token` 未设置时，`/ui/api/config`、`/ui/api/control`、`/ui/api/providers` 的写接口不做校验（`server/auth.ts:5`）

## 环境变量

**proxy-core**

| 变量 | 作用 |
|---|---|
| `CONFIG_PATH` | 覆盖 config 路径（低于 `--config`） |
| `CC_DATA_DIR` | 覆盖数据目录（ecosystem.config.cjs 使用） |
| `UI_AUTH_TOKEN` | 覆盖 `auth.token`，`config.auth.token` 未配置时兜底 |
| `NODE_ENV` | PM2 环境切换（development / production） |

**proxy-cli**

由 `apps/proxy-cli/vite.config.ts:11-19` 的 dev 代理决定：`/ui/api` 转发到 `http://localhost:3000`（含 WebSocket 升级）。

**proxy-admin**（`.env` / `.env.local`）

| 变量 | 默认 | 作用 |
|---|---|---|
| `VITE_API_PREFIX` | `/api` | axios baseURL |
| `VITE_API_PROXY_TARGET` | `http://localhost:8080` | Vite 开发代理目标 |

类型声明位于 `apps/proxy-admin/src/vite-env.d.ts:3-8`。

## 连接 Claude Code

启动后，把 Claude Code / Claude Agent SDK 的 API endpoint 指向本地代理：

```bash
export ANTHROPIC_BASE_URL=http://localhost:9527
# 或
export ANTHROPIC_API_URL=http://localhost:9527
claude ...
```

之后所有 `/v1/*` 请求都会经过 proxy-core 转发到 `proxy.target` 配置的上游，同时被记录到 SQLite。

## 开发工作流

**只改 proxy-core**：

```bash
pnpm dev:proxy-core   # tsx 直接跑 src/server/index.ts
```

自动重载。此模式**不走 PM2**，直接用 Fastify 的 `startServer()`（`server/index.ts:30-40`）。

**改 proxy-cli 组件**：

```bash
# 终端 1
pnpm dev:proxy-core   # 后端 9527
# 终端 2
pnpm dev:proxy-cli    # 前端 Vite HMR，通过 vite.config.ts 反代到 localhost:3000/ui/api（注意：vite 硬编码 3000，与 core 默认 9527 不一致，dev 时需将 core 端口改成 3000 或改 vite 配置）
```

注意：`useWebSocketData` 和 `useLogs` 在 `import.meta.env.DEV` 下直连 `ws://localhost:3000`（`apps/proxy-cli/src/hooks/useWebSocketData.ts:88`）——目前是硬编码 3000。生产模式则用 `location.host`。

**改 proxy-admin**：

```bash
pnpm dev:proxy-admin  # Vite + vite-plugin-mock（假数据来自 src/mock/*）
```

## 生产部署

- 直接在服务器上 `pnpm install && pnpm build && pnpm start`
- PM2 通过 `apps/proxy-core/ecosystem.config.cjs` 守护，参数：`max_memory_restart: 200M`、`exec_mode: fork`（因 ESM 只能 fork）
- 数据与配置默认写 `$HOME/.cc-monitoring/`，可通过 `CC_DATA_DIR` 覆盖
- 通过 `/ui/api/control`（Bearer 认证）可远程 start/stop/restart 进程；也可 `pnpm stop / reload`

## 常见故障

| 现象 | 定位 |
|---|---|
| `start` 卡在 `Verifying port` | 上游 target 不可达，看 `~/.cc-monitoring/logs/error.log` |
| 面板显示 disconnected 红条 | `ConnectionBanner` 检测 WebSocket 断开；服务未启动或端口不通 |
| `POST /ui/api/config` 返回 401 | 配置了 `auth.token` 但请求头缺 `Authorization: Bearer <token>` |
| `POST /ui/api/providers` 报重名/duplicate name | validateProviders 检测到重复 `name`（`providers-db.ts:140-148`） |
| 版本信息 `claudeVersion: not installed` | 未装 Claude Code CLI，或 PM2 环境 `PATH` 丢失（`utils/version.ts`） |

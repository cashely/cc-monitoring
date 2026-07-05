# @cc-monitoring/proxy-core

Claude Code 代理 + 监控 CLI。Fastify 应用层转发 + PM2 守护进程 + Web 管理面板 + 完整请求记录。

一站式解决国内网络访问 Claude Code 的问题，同时提供请求日志、Token 统计、供应商切换、SSE 流式抓包等运维能力。

[![npm version](https://img.shields.io/npm/v/@cc-monitoring/proxy-core.svg)](https://www.npmjs.com/package/@cc-monitoring/proxy-core)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)

## 安装

```bash
npm i -g @cc-monitoring/proxy-core
# 或
pnpm add -g @cc-monitoring/proxy-core
```

要求 Node.js ≥ 18。

## 快速上手

```bash
# 1. 启动代理（PM2 守护）
ccm start

# 2. 打开 Web 面板配置供应商
ccm ui

# 3. 把 Claude Code 的 ANTHROPIC_BASE_URL 指向本地代理
export ANTHROPIC_BASE_URL=http://localhost:3000
```

首次运行会在 `~/.cc-monitoring/` 生成配置文件和数据库：

```
~/.cc-monitoring/
├── config.json     # 运行时配置
├── data.db         # SQLite（请求记录、供应商）
└── logs/           # 日志
```

## CLI 命令

| 命令 | 说明 | 常用选项 |
|------|------|---------|
| `ccm start` | PM2 守护启动代理服务器 | `-p, --port <port>` 临时覆盖端口 |
| `ccm stop` | 停止服务器 | |
| `ccm status` | 查看运行状态（CPU / 内存 / 运行时间） | |
| `ccm reload` | 优雅重启（不中断连接） | |
| `ccm logs [n]` | 查看最近日志 | `-l, --level <level>` 按级别过滤；`-g, --grep <pattern>` 关键字 |
| `ccm config <action> [key] [value]` | 配置管理 | `show` / `set` / `reset` |
| `ccm test` | 测试上游 API 连通性 | |
| `ccm ui` | 打开 Web 管理面板 | |

示例：

```bash
ccm start --port 8080                     # 8080 端口启动
ccm logs 50 -l error                      # 最近 50 行 error 日志
ccm logs -g timeout                       # 搜索 timeout
ccm config set proxy.target https://xxx   # 修改上游地址
```

## 配置

`~/.cc-monitoring/config.json`（Zod schema 校验，非法配置拒绝启动）：

```json
{
  "server": { "port": 3000, "host": "localhost" },
  "proxy": {
    "target": "https://token-plan.cn-beijing.maas.aliyuncs.com/apps/anthropic",
    "changeOrigin": true,
    "rewritePrefix": ""
  },
  "logging": { "level": "info", "file": "logs/proxy.log" },
  "auth": { "token": "" }
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `server.port` | number (1-65535) | 监听端口，默认 3000 |
| `server.host` | string | 监听主机 |
| `proxy.target` | URL | 上游 AI 供应商 API |
| `proxy.changeOrigin` | boolean | 是否重写 Origin 头 |
| `proxy.rewritePrefix` | string | 转发时重写路径前缀 |
| `logging.level` | `debug` \| `info` \| `warn` \| `error` | 日志级别 |
| `auth.token` | string | Web UI 配置修改 API 的 Bearer Token（可空） |

多供应商配置存 SQLite（Web UI 可视化管理），不入 `config.json`。

## Web 管理面板

`ccm ui` 或访问 `http://localhost:3000/ui`：

- **状态监控**：CPU / 内存 / 运行时间 / 重启次数（5s 刷新）
- **实时日志**：WebSocket 推流、级别过滤、关键字搜索
- **请求历史**：完整 payload + SSE events，Token 消耗、耗时统计
- **配置编辑**：可视化改 `config.json`，Zod 实时校验
- **供应商管理**：多供应商配置，一键切换 baseUrl / apiKey / model

## 架构要点

**应用层转发**（Controller + Fetch + SSE Pipe），非透明代理：

```
Claude Code
   ↓ POST /v1/messages
Fastify（解析 body）
   ↓ saveRequest（记录完整 payload）
fetch → 上游 API
   ↓ Web ReadableStream
reply.hijack() + Readable.fromWeb().pipe(reply.raw)
   ↓ 原样 SSE 转发
Claude Code
```

为什么不用透明代理：`@fastify/http-proxy` 内部消费 request stream，无法同时完成「记录 body + 转发 SSE + 未来鉴权/统计」。HTTP stream 只能消费一次。

**关键处理**：
- Web Stream → Node Stream：`Readable.fromWeb(response.body)`
- 头处理：删 `host`（阿里云 404）、`content-length`（长度变化），保留 `anthropic-version` / `x-api-key` / `accept: text/event-stream`
- SSE 记录：`nodeStream.on('end')` 落盘完整 events 数组

## 环境变量

| 变量 | 说明 |
|------|------|
| `CC_DATA_DIR` | 覆盖数据目录（默认 `~/.cc-monitoring`） |
| `CONFIG_PATH` | 覆盖配置文件路径 |
| `UI_AUTH_TOKEN` | Web UI 认证 Token（覆盖 `config.json` 的 `auth.token`） |

## 常见问题

**502 Bad Gateway**：`ccm test` 检查上游连通性。

**Web UI 改配置 401**：配置了 `auth.token` 但请求缺 `Authorization: Bearer <token>` 头。

**PM2 版本信息异常**：`pm2 kill` 后重启。

## 相关包

- Monorepo 源码：https://github.com/cashely/cc-monitoring
- Web 面板（内嵌，不单独发布）：`@cc-monitoring/proxy-cli`

## License

Apache-2.0 © cashely

# proxy-core

## 本文档覆盖的源文件

- `apps/proxy-core/package.json`
- `apps/proxy-core/tsconfig.json`
- `apps/proxy-core/src/**/*.ts`（不含测试）

## 模块角色

`proxy-core` 是整个系统的后端。它承担四类职责：

1. **业务代理**：转发 Claude Code 的 `/v1/*` 请求到上游 AI API，同时记录完整请求与响应
2. **UI 后端**：提供 REST API + 两个 WebSocket 通道给前端面板（proxy-cli）
3. **CLI 工具**：`proxy` 命令行工具，用于 start/stop/status/logs/config/reload/test/ui/clean-requests
4. **静态资源托管**：`@fastify/static` 挂载 `proxy-cli/dist` 到 `/ui/`

发布名：`@cc-monitoring/cli-core`，`bin/proxy` → `dist/cli/index.js`，`main` → `dist/server/index.js`。

## 目录布局

```
apps/proxy-core/
├── bin/proxy-cli.ts          # 一行 bin，只 import dist/cli/index.js
├── ecosystem.config.cjs      # PM2 配置（.cjs 因为 root type=module）
├── package.json
├── tsconfig.json
└── src/
    ├── cli/
    │   ├── index.ts          # Commander 命令注册
    │   └── commands/
    │       ├── start.ts
    │       ├── stop.ts
    │       ├── status.ts
    │       ├── logs.ts
    │       ├── config.ts
    │       ├── reload.ts
    │       ├── test.ts
    │       └── ui.ts
    ├── server/
    │   ├── index.ts          # createServer / startServer / ESM+PM2 入口判断
    │   ├── proxy.ts          # 代理转发核心 (486 行)
    │   ├── ui-route.ts       # REST + 双 WebSocket + 静态挂载
    │   ├── providers-route.ts
    │   ├── data-push.ts      # WebSocket 广播工具
    │   ├── auth.ts           # Bearer Token 校验
    │   └── middleware/
    │       └── request-id.ts # nanoid + x-request-id
    ├── config/
    │   ├── index.ts          # load / save / reset
    │   └── schema.ts         # Zod 校验
    ├── logger/
    │   └── index.ts          # Pino + file-stream-rotator
    ├── utils/
    │   ├── db.ts             # SQLite 初始化 + 4 版 schema 迁移
    │   ├── providers-db.ts   # providers 表 CRUD + validate
    │   ├── request-writer.ts # requests 表读写
    │   ├── stats-aggregator.ts
    │   ├── status-history.ts # 内存中的 CPU/内存滑动窗口
    │   ├── sse-accumulator.ts
    │   ├── sse-writer.ts     # 合成 SSE
    │   ├── tool-injector.ts
    │   ├── inject-loop.ts    # tool 命中后的内部循环
    │   ├── pm2.ts            # PM2 promise 封装
    │   ├── paths.ts          # ~/.cc-monitoring 锚点
    │   ├── esm-dirname.ts    # ESM+CJS 双模 __dirname
    │   ├── net.ts            # waitForPort
    │   ├── version.ts        # 项目 + Claude Code 版本
    │   └── migrate-files-to-db.ts # 旧文件系统迁移到 SQLite（一次性脚本）
    ├── tools/
    │   ├── index.ts          # 转发 registry 导出
    │   ├── registry.ts       # ALL_TOOLS + enabled/find
    │   ├── types.ts          # InjectableTool 接口
    │   ├── curl.tool.ts
    │   └── probe.tool.ts
    └── types/
        ├── api.ts / config.ts / log.ts / pm2.ts / index.ts
```

## 依赖速览

`apps/proxy-core/package.json`：

- `fastify` `4.26` + `@fastify/static` `7.0` + `@fastify/http-proxy` `9.5`（**未使用**，早期遗留）
- `@fastify/websocket` `10`（也未使用，服务器直接用原生 `ws`）
- `commander` `11.1`、`chalk` `5.6`、`ora` `9.4`（CLI 交互）
- `better-sqlite3` `12.11` + `@types/better-sqlite3`
- `pino` `8.18` + `pino-pretty` `10.3` + `file-stream-rotator` `1.0`（日志）
- `pm2` `5.4`
- `nanoid` `5.0`（request id）
- `open` `10.1`（`ui` 命令打开浏览器）
- `ws` `8.21`（原生 WebSocket）
- `zod` `3.23`

Dev：Jest 29 + ts-jest + tsx 4。

## 阅读顺序

- 先看启动 → [entry.md](./entry.md)
- 后看代理核心 → [proxy.md](./proxy.md)
- 想理解数据 → [data-layer.md](./data-layer.md) + [stats.md](./stats.md)
- 想扩展 tool → [tool.md](./tool.md)
- 想改 UI 端点 → [ui-routes.md](./ui-routes.md)
- 想改供应商 → [providers.md](./providers.md)
- 想改配置字段 → [config.md](./config.md)
- 打包/进程细节 → [pm2.md](./pm2.md)
- 底层小工具 → [utilities.md](./utilities.md)
- CLI 每个命令 → [cli.md](./cli.md)

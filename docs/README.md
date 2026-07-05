# cc-monitoring 架构文档

> 本目录汇总 `cc-monitoring` monorepo 的完整实现说明。阅读顺序建议：
> **总览 → 快速上手 → 请求流转 → 各模块深入**。

## 顶层文档

- [00. 项目总览](./architecture/00-overview.md) — 定位、Monorepo 结构、跨应用依赖图
- [01. 快速上手](./architecture/01-quickstart.md) — 安装、构建、启动、CLI、环境变量
- [02. 端到端请求流转](./architecture/02-request-flow.md) — Claude Code → Proxy → 上游 → 回流 → 记录 → 推送

## proxy-core（后端代理服务）

- [模块总览](./architecture/proxy-core/README.md)
- [启动链](./architecture/proxy-core/entry-and-bootstrap.md) — bin / cli / server 入口
- [CLI 命令](./architecture/proxy-core/cli-commands.md) — 9 条命令详解
- [代理转发](./architecture/proxy-core/proxy-forwarding.md) — `setupProxy` 5 条分支路径
- [UI Routes](./architecture/proxy-core/ui-routes.md) — REST + 双 WebSocket + 静态资源
- [供应商管理](./architecture/proxy-core/providers.md) — SQLite + REST + 动态覆盖策略
- [配置 & 日志](./architecture/proxy-core/config-and-logger.md) — Zod schema + Pino + 日志轮转
- [数据层](./architecture/proxy-core/data-layer.md) — SQLite schema v1-v4 迁移
- [统计与历史](./architecture/proxy-core/stats-and-history.md) — 聚合、今日实时、状态历史
- [Tool 注入](./architecture/proxy-core/tool-injection.md) — 注册表 + 注入器 + 内部循环 + 合成 SSE
- [PM2 集成](./architecture/proxy-core/pm2-integration.md) — ESM↔CJS 桥接
- [公共工具](./architecture/proxy-core/utilities.md) — paths / esm-dirname / net / version / auth / request-id

## proxy-cli（Proxy 管理面板）

- [模块总览](./architecture/proxy-cli/README.md)
- [应用外壳](./architecture/proxy-cli/app-shell.md) — App.tsx + main.tsx + i18n
- [数据 Hooks](./architecture/proxy-cli/data-hooks.md) — useWebSocketData / useLogs / useConfig / useInViewControl
- [API 层](./architecture/proxy-cli/api-layer.md) — REST 客户端封装
- [状态类组件](./architecture/proxy-cli/components-status.md) — StatusPanel / StatusLineChart / ConnectionBanner
- [统计类组件](./architecture/proxy-cli/components-stats.md) — StatsBarChart / TodayStatsCards / TokenBarChart
- [请求类组件](./architecture/proxy-cli/components-requests.md) — RequestHistory / RequestCard / RequestCompareModal / DiffPanel / ParsedResponseBlocks
- [配置类组件](./architecture/proxy-cli/components-config.md) — ConfigEditor / ProviderManagerModal
- [通用组件](./architecture/proxy-cli/components-common.md) — Tabs / Tags / GlowCard / ShikiHighlighter / LanguageSwitcher
- [工具与 i18n](./architecture/proxy-cli/utils-and-i18n.md) — parse-events / format-time / format-number / 命名空间

## proxy-admin（系统管理后台）

- [模块总览](./architecture/proxy-admin/README.md)
- [路由与认证](./architecture/proxy-admin/routing-and-auth.md)
- [布局与菜单](./architecture/proxy-admin/layout-and-menu.md)
- [页面清单](./architecture/proxy-admin/pages.md)
- [服务层与 Mock](./architecture/proxy-admin/services-and-mock.md)
- [环境与构建](./architecture/proxy-admin/env-and-build.md)

## 公共包

- [packages/utils](./architecture/packages-utils.md)

---

## 文档约定

- 所有源码引用格式：`apps/xxx/src/foo.ts:12-34`，可通过编辑器/终端直接跳转
- Mermaid 图使用 GitHub 支持的语法
- 术语「上游」= 配置的 AI 供应商 API；「客户端」= Claude Code / SDK
- 除非特别说明，「WS」= WebSocket

## 阅读建议

- **只想接入代理**：`01-quickstart.md`
- **想理解转发原理**：`02-request-flow.md` + `proxy-core/proxy-forwarding.md`
- **想扩展 tool 注入**：`proxy-core/tool-injection.md`
- **想改前端面板**：`proxy-cli/README.md` 起
- **想改管理后台**：`proxy-admin/README.md` 起

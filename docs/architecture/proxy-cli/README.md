# proxy-cli

## 本文档覆盖的源文件

- `apps/proxy-cli/package.json`
- `apps/proxy-cli/vite.config.ts`
- `apps/proxy-cli/src/**/*.{ts,tsx}`（不含 `*.test.tsx`）

## 模块角色

`proxy-cli`（发布名 `@cc-monitoring/cli`，实际是 Proxy 管理面板）是给单机用户的仪表板。构建产物由 proxy-core 通过 `@fastify/static` 挂在 `/ui/` 路径下，运行时是一个纯 SPA。

四大功能区：

1. **状态监控** — 顶部 CPU/内存折线图 + 连接状态 banner
2. **Token 统计** — 今日实时卡片 + 24h/30d 柱状图
3. **请求历史** — 按 session 分组的请求列表，展开看 Headers/Body/Events，双选对比
4. **配置与供应商** — 显示监听地址/配置路径 + 重启按钮 + 供应商管理弹窗 + MCP server 管理

## 目录布局

```
apps/proxy-cli/
├── package.json
├── vite.config.ts       # base: '/ui/', dev 反代到 http://localhost:3000
├── postcss.config.js    # Tailwind 4 后处理
└── src/
    ├── main.tsx         # React 挂载 + i18n 初始化
    ├── App.tsx          # 布局：Header + StatsBarChart + RequestHistory + StatusPanel + ConfigEditor
    ├── index.css        # Tailwind 入口
    ├── i18n/
    │   ├── index.ts     # i18next 初始化，7 命名空间 × 2 语言
    │   └── locales/
    │       ├── zh/*.json (common/app/status/log/config/providers/mcp)
    │       └── en/*.json
    ├── api/
    │   ├── index.ts     # REST 端点封装 + 转发 providers
    │   ├── providers.ts # 供应商 REST
    │   └── mcp.ts       # MCP server 管理 REST
    ├── hooks/
    │   ├── index.ts     # barrel
    │   ├── useConfig.ts # /ui/api/config 一次拉
    │   ├── useLogs.ts   # WebSocket 日志流
    │   ├── useWebSocketData.ts  # 主数据通道
    │   └── useInViewControl.ts  # 展开渲染懒加载
    ├── components/
    │   ├── StatusPanel.tsx / StatusLineChart.tsx / ConnectionBanner.tsx
    │   ├── StatsBarChart.tsx / TodayStatsCards.tsx / TokenBarChart.tsx / chart-theme.ts
    │   ├── RequestHistory.tsx / RequestCard.tsx / RequestCompareModal.tsx / DiffPanel.tsx / ParsedResponseBlocks.tsx
    │   ├── ConfigEditor.tsx / ProviderManagerModal.tsx / McpManagerPanel.tsx
    │   ├── Tabs.tsx / MethodTag.tsx / ModelTag.tsx / GlowCard.tsx / ShikiHighlighter.tsx / LanguageSwitcher.tsx
    ├── utils/
    │   ├── parse-events.ts / format-time.ts / format-number.ts
    ├── types/
    │   ├── config.ts / log.ts / providers.ts / request.ts / stats.ts / status.ts / version.ts / mcp.ts / index.ts
    └── test/setup.ts
```

## 技术栈

`apps/proxy-cli/package.json`：

- **React 18** + **TypeScript 5**
- **Vite 5**（构建 + HMR）
- **Tailwind 4**（原生 CSS 变量，`@tailwindcss/postcss`）
- **Recharts 2**（图表）
- **Shiki 4**（JSON 代码高亮）
- **@pierre/diffs**（请求对比 diff 视图）
- **react-markdown 10**（AI 响应文本渲染）
- **react-countup 6**（今日统计卡数字动画）
- **react-intersection-observer 10**（展开懒渲染）
- **@tanstack/react-virtual 3**（未见实际使用，可能预留）
- **lucide-react 1**（图标）
- **i18next 26** + **react-i18next 17** + **i18next-browser-languagedetector 8**
- **Vitest 1** + **@testing-library/react 16** + **msw 2**（前端单测）

无 Ant Design、无 axios、无 Redux/Zustand——全 hooks + fetch。

## 阅读顺序

- [app-shell.md](./app-shell.md) — 入口 & 布局
- [data-hooks.md](./data-hooks.md) — 数据流（重要，含 WebSocket 状态机）
- [api-layer.md](./api-layer.md) — 与后端的契约
- [components-status.md](./components-status.md) — 状态面板
- [components-stats.md](./components-stats.md) — 统计柱状图与卡片
- [components-requests.md](./components-requests.md) — 请求历史与对比
- [components-config.md](./components-config.md) — 配置与供应商
- [components-common.md](./components-common.md) — 通用小组件
- [utils-and-i18n.md](./utils-and-i18n.md) — 工具函数 & 多语言

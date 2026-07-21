# CLAUDE.md

Claude Code 行为准则 + 项目特定规范。

## Behavioral Guidelines

偏向谨慎而非速度。简单任务可灵活判断。

### 1. Think Before Coding
- 不假设，不隐藏困惑，显式陈述权衡
- 不确定就问，多种解读就呈现，不默选
- 存在更简单方案就说出来，必要时反驳
- 不懂就停，点名困惑点，再问

### 2. Simplicity First
- 最小代码解决问题，不写额外功能
- 单次使用不抽象，不编造"灵活性"
- 不处理不可能场景的错误
- 200 行能减到 50 行就重写
- 问自己："资深工程师会觉得过度复杂？" → 是则简化

### 3. Surgical Changes
- 只改必要的，只清理自己制造的混乱
- 不"改进"相邻代码/注释/格式
- 不重构未损坏的东西
- 匹配现有风格，即使你不喜欢
- 注意到无关死代码就提，不删（除非被问）
- **测试**：每行修改应能追溯到用户请求

### 4. Goal-Driven Execution
- 定义成功标准，循环直到验证
- 任务转可验证目标：
  - "加验证" → "写失败输入测试，然后让它们通过"
  - "修 bug" → "写重现测试，然后让它通过"
  - "重构 X" → "确保前后测试都通过"
- 多步任务简述计划：
  ```
  1. [步骤] → 验证: [检查点]
  2. [步骤] → 验证: [检查点]
  ```
- 强成功标准可独立循环，弱标准需持续澄清

---

## Project Purpose

CC Monitoring - Claude Code 代理 + 监控系统，一站式解决国内开发者使用 Claude Code 的网络问题，提供完整的请求监控、日志分析、用户管理能力。Monorepo 结构（pnpm workspaces）：
- **apps/proxy-core**: Fastify 代理服务器 + PM2 进程管理 + Commander CLI + 供应商配置管理（SQLite 数据层）
- **apps/proxy-cli**: React UI 仪表板（状态监控、日志流、请求历史、配置编辑、供应商管理）
- **apps/proxy-admin**: React 管理后台（用户管理、权限控制、系统配置、全局监控）

## Common Commands

### Installation & Build
```bash
pnpm install              # 安装依赖
pnpm build                # 构建所有包
pnpm build:proxy-core     # 构建核心代理服务
pnpm build:proxy-cli      # 构建代理管理面板
pnpm build:proxy-admin    # 构建系统管理后台
pnpm build:proxy-docs     # 构建架构文档（VitePress）
```

### Server Management
```bash
pnpm start                # 启动代理服务器（PM2 守护）
pnpm status               # 查看服务器状态
pnpm stop                 # 停止服务器
pnpm reload               # 优雅重启
pnpm test-connection      # 测试与目标 API 的连通性
pnpm logs [n]             # 查看日志
pnpm config               # 查看配置
pnpm ui                   # 打开代理管理面板
pnpm admin                # 打开系统管理后台
```

### CLI Commands
```bash
pnpm cli --help                              # 查看所有命令
pnpm cli start --port 8080                   # 临时覆盖监听端口
pnpm cli config set server.port 3001         # 修改配置
pnpm cli logs -l error                       # 按级别过滤日志
pnpm cli logs -g <pattern>                   # 关键字搜索日志
```

### Development
```bash
pnpm dev:proxy-core       # Core 开发模式（tsx 热重载）
pnpm dev:proxy-cli        # Proxy UI 开发模式（Vite HMR）
pnpm dev:proxy-admin      # Admin UI 开发模式（Vite HMR）
pnpm dev                  # 同时启动 Core + Proxy UI
pnpm docs                 # 本地预览架构文档（VitePress dev server）
```

### Testing
```bash
pnpm test                                    # 运行所有测试
pnpm --filter @cc-monitoring/cli-core test   # Core 测试（Jest）
pnpm --filter @cc-monitoring/cli test        # Proxy UI 测试（Vitest）
pnpm --filter proxy-admin test               # Admin UI 测试（Vitest）
```

## Architecture

### Proxy 转发架构（核心）
**应用层转发**（Controller + Fetch + SSE Pipe），而非 @fastify/http-proxy 透明代理。

**为什么不用透明代理**：
- 透明代理无法读取 request body（stream 已被代理消耗）
- 无法同时：记录完整 payload + SSE 原样转发 + 实现请求监控/统计
- HTTP stream 只能消费一次

**实现要点**（`apps/proxy-core/src/server/proxy.ts`）：
```typescript
fastify.post('/v1/*', async (request, reply) => {
  const payload = request.body  // Fastify 已解析 JSON
  
  await saveRequest({ headers, body: payload })  // 记录完整请求
  
  const response = await fetch(targetUrl, {
    method: 'POST',
    headers: filterForwardHeaders(request.headers),
    body: JSON.stringify(payload)
  })
  
  reply.hijack()  // 接管响应控制权
  reply.raw.writeHead(response.status, response.headers)
  
  const nodeStream = Readable.fromWeb(response.body)  // Web → Node Stream
  nodeStream.pipe(reply.raw)  // SSE 原样转发
})
```

**关键技术点**：
1. **Web Stream → Node Stream**：`Readable.fromWeb(response.body)`
2. **reply.hijack()**：Fastify 不接管响应，自己控制 HTTP stream
3. **Headers 处理**：删除 `host`（阿里云 404）、`content-length`（长度变化），保留 `anthropic-version`, `x-api-key`, `accept: text/event-stream`
4. **URL 拼接**：`baseUrl + targetPath + request.url`
5. **SSE 记录**：`nodeStream.on('end')` 保存完整请求+响应（events 数组）

**请求流程**：
```
Claude Code → Fastify (解析) → saveRequest → fetch → Aliyun 
→ SSE → Readable.fromWeb → pipe → Claude Code → end → saveRequestFile
```

### ESM Module System
- 全局 `"type": "module"`，编译 ES2022/ESNext
- 相对导入必须 `.js` 扩展名（runtime 要求）
- 入口点用 `import.meta.url` guard（非 `require.main === module`）
- PM2 配置 `.cjs` 扩展名，通过 `createRequire(import.meta.url)` 加载（CJS 兼容）

### Project Structure
```
cc-monitoring/
├── apps/
│   ├── proxy-core/       # @cc-monitoring/cli-core
│   │   ├── src/
│   │   │   ├── server/   # Fastify + Proxy + API
│   │   │   ├── cli/      # Commander (8 命令)
│   │   │   ├── config/   # Zod schema
│   │   │   ├── logger/   # Pino
│   │   │   ├── utils/    # PM2 封装 + DB 操作
│   │   │   └── types/    # TypeScript 类型
│   │   └── ecosystem.config.cjs  # PM2 配置（CJS）
│   ├── proxy-cli/        # @cc-monitoring/cli
│   │   └── src/
│   │       ├── components/  # 状态面板、日志查看器、配置编辑器
│   │       ├── hooks/       # 自定义 hooks
│   │       └── api/         # 请求封装
│   └── proxy-admin/      # 系统管理后台
│       └── src/
│           ├── pages/       # 管理页面
│           ├── services/    # API 层
│           └── components/  # 业务组件
│   └── proxy-docs/      # 架构文档（VitePress）
├── packages/
│   └── utils/            # @cc/utils（跨项目复用工具）
└── docs/                 # 开发流程文档（thinks/、superpowers/）
```

### Configuration Schema
运行时配置存 `~/.cc-monitoring/config.json`（Zod 校验，`apps/proxy-core/src/config/schema.ts`）。日志和 SQLite 也存 `~/.cc-monitoring/` 下，项目根目录不含运行时数据文件。
```typescript
{
  server: { port, host },
  proxy: { target (URL), changeOrigin, rewritePrefix? },
  logging: { level, file },
  auth?: { token }  # 配置修改 API 认证
}
```

### Providers 管理（供应商配置）
独立数据管理模块，管理 AI 供应商配置（baseUrl、apiKey、各 tier model）。

**数据层**：SQLite `providers` 表（`apps/proxy-core/src/utils/providers-db.ts`）
- 字段：id, name, base_url, api_key, model, haiku_model, sonnet_model, opus_model, subagent_model, provider, createdAt, updatedAt
- 操作：listAll, batchSave（全量替换：事务内 DELETE ALL + INSERT 列表）

**API 层**：REST API（`apps/proxy-core/src/server/providers-route.ts`）
- `GET /ui/api/providers`：列出所有供应商
- `POST /ui/api/providers`：批量保存

**UI 层**：`ProviderManagerModal`（`apps/proxy-cli/src/components/ProviderManagerModal.tsx`）
- 表格 + 模态框表单，批量提交
- 集成在配置编辑器中

### WebSocket Log Stream
- `/ui/api/logs/stream`：`fs.watch` + 增量读取
- 发送：初始 50 行，每次更新发送新增行（位置跟踪）

### Test Infrastructure
- **Core**: Jest + ts-jest，PM2 mock
- **UI**: Vitest + jsdom + @testing-library/react，Mock WebSocket
- **Admin**: Vitest + @testing-library/react

## Important Files
- `~/.cc-monitoring/config.json`：运行时配置（项目外）
- `apps/proxy-docs/`：架构文档（VitePress 项目）
- `apps/proxy-core/src/server/proxy.ts`：Proxy 转发核心
- `apps/proxy-core/src/server/ui-route.ts`：UI API + WebSocket + 静态资源
- `apps/proxy-core/src/server/providers-route.ts`：供应商 REST API
- `apps/proxy-core/src/utils/providers-db.ts`：供应商 SQLite 数据层
- `apps/proxy-core/src/cli/index.ts`：CLI 命令注册
- `apps/proxy-core/src/utils/pm2.ts`：PM2 操作封装
- `apps/proxy-core/ecosystem.config.cjs`：PM2 配置
- `apps/proxy-cli/src/components/ProviderManagerModal.tsx`：供应商管理 UI 组件
- `apps/proxy-admin/src/pages/`：系统管理后台页面

## Key Design Decisions
1. **ESM dirname**: `utils/esm-dirname.ts` 计算 `__dirname` 等价物
2. **PM2 ESM**: `createRequire(import.meta.url)` 加载 CJS 包
3. **ecosystem.config.cjs**: `.cjs` 扩展名（全局 `"type": "module"`）
4. **Data dir**: 运行时数据（config.json、logs、proxy.db）存 `~/.cc-monitoring/`，项目根目录不含运行时数据
5. **Type casts**: `PinoLike = any`（Fastify/pino 类型不匹配）
6. **Providers separate storage**: 供应商配置存 SQLite 而非 config.json，避免配置膨胀，使用全量替换保存模式
7. **Monorepo 结构**：三个应用独立部署，共享公共工具包

## ESM Compatibility Notes
- PM2 是 CJS 包，需 `createRequire` 加载
- ecosystem.config 必须 `.cjs`（`.js` 被视为 ESM）
- 相对导入必须 `.js` 扩展名
- 不用 `require.main === module`

---

## 项目规范

### 技术栈规范
- 包管理器：统一使用pnpm，禁止使用npm/yarn
- UI组件库：统一使用Ant Design v5，禁止引入其他UI库
- 状态管理：优先使用React内置的useState/useContext，复杂场景再考虑引入Zustand/Redux
- 代码风格：遵循TypeScript严格模式，启用所有严格检查

### 目录规范
- `apps/`：存放所有应用项目，每个子项目是独立的可部署应用
- `packages/`：存放公共可复用包，可跨多个应用项目引用
- 公共工具函数：跨项目复用的放到 `packages/utils`，项目内复用的放到对应项目的 `src/utils`

### 环境变量规范
- 公共环境变量（如接口前缀）放到 `.env`，提交到git
- 敏感环境变量（如本地代理地址、密钥）放到 `.env.local`，不提交git
- 新增环境变量需要在 `src/vite-env.d.ts` 中添加类型声明

### 代码提交规范
- 提交信息格式：`type: description`
- type可选值：feat（新功能）、fix（修复bug）、docs（文档）、style（格式）、refactor（重构）、test（测试）、chore（构建/工具）

### proxy-cli UI 开发规范
**重要**：对 proxy-cli 进行任何 UI 调整时，必须先参考 README.md 中的「主题配置」章节，确保符合当前配置的主题系统。

1. **颜色使用**：始终使用 CSS 变量 `var(--color-*)`，禁止硬编码颜色值
2. **Glassmorphism**：使用 `.glass` 或 `.glass-strong` 工具类实现玻璃态效果
3. **字体大小**：正文统一 12px（`text-xs`），标题可稍大（`text-sm` / `text-base`）
4. **主题切换**：确保新增组件同时支持暗黑/亮色主题，通过 `.light` class 区分
5. **Ant Design 配置**：通过 ConfigProvider 统一设置 `fontSize: 12`

完整主题配置参考：`apps/proxy-cli/src/index.css` 和 README.md「主题配置」章节。

### 开发流程规范
1. 每次收到任务需求之前必须进行需求分析，确保能理解用户的需求
2. 对于需求实现的方案必须跟用户确认才能执行接下来的动作
3. 每次编码之前都确保工作区文件的改动都已经提交，否则不允许执行代码变更
4. 不允许做超出需求外的文件变更，确保每次的代码变更都是以完成任务为目标，确保最小修改原则
5. 在每次编码完成以后都需要对代码进行codereview，没有经过review的代码不允许提交commit变更
6. 对于前端项目的编码在codereview完成以后必须进行构建，确保构建是能够成功的，否则也不允许提交代码

# CC Monitoring - Claude Code 代理监控系统

> 一站式解决国内开发者使用 Claude Code 的网络问题，提供完整的请求监控、日志分析、用户管理和系统配置能力。一行命令启动，多界面管理，让 Claude Code 访问无障碍。

[![Build Status][build-badge]][build-link]
[![Test Coverage][coverage-badge]][coverage-link]
[![License: MIT][license-badge]][license-link]

## 为什么需要这个项目
Claude Code 直接访问 Anthropic API 在国内网络环境下受限。CC Monitoring 在本地启动一个 Fastify 代理服务器，将所有请求透明转发到阿里云中转服务，同时提供完整的请求监控、日志流、用户管理、权限控制等企业级能力。你只需要改一个 API endpoint 配置，其余一切照旧。

## 功能特性
- **代理转发** -- 透明转发 Claude Code 请求到阿里云 API，支持 `changeOrigin` 和路径重写
- **完整请求记录** -- 记录请求 headers、body + 响应 headers、SSE events（支持阿里云格式）
- **PM2 进程管理** -- start / stop / reload / status，生产级守护进程
- **CLI 工具** -- 8 个命令覆盖日常运维（start, stop, status, logs, config, reload, test, ui）
- **WebSocket 日志流** -- 实时推送代理日志到浏览器，支持级别过滤和关键字搜索
- **双 Web UI 管理面板**：
  - **Proxy 管理面板** -- 状态监控、日志查看、请求历史、配置编辑、供应商管理
  - **系统管理后台** -- 用户管理、权限控制、全局监控、系统配置
- **Zod 配置校验** -- 启动前自动校验 config.json，错误配置不会上线
- **认证保护** -- 配置修改 API 支持 Bearer Token 认证，防止未授权改动
- **多供应商支持** -- 同时管理多个 AI 供应商配置，支持一键切换
- **请求统计** -- 统计请求次数、Token 消耗、成功率等核心指标

## 快速开始
**前提条件**: Node.js 18+, pnpm 8+

```bash
# 安装依赖
pnpm install

# 构建所有包
pnpm build

# 启动代理服务器（从根目录运行）
pnpm start
```

服务器启动后监听 `http://localhost:3000`。将 Claude Code 的 API endpoint 配置为这个地址即可开始使用。

```bash
# 验证代理是否正常工作
pnpm test-connection
```

## 项目结构
本项目采用pnpm monorepo架构：
```
.
├── apps/                  # 应用目录
│   ├── proxy-core/        # 核心代理服务（Fastify + CLI + PM2）
│   ├── proxy-cli/         # Proxy 管理面板（React + Vite）
│   └── proxy-admin/       # 系统管理后台（React + Vite + Ant Design）
├── packages/              # 公共包目录
│   └── utils/             # 通用工具函数（跨项目复用）
├── docs/                  # 文档目录
├── config.json            # 运行时配置
├── logs/                  # 日志目录
├── package.json
├── pnpm-workspace.yaml
└── tsconfig.base.json
```

## 技术栈
- 包管理器：pnpm 8+
- 服务端：Node.js 18 + Fastify 4 + TypeScript 5
- 前端框架：React 18 + TypeScript 5
- 路由：React Router v6
- UI组件库：Ant Design v5
- HTTP客户端：Axios
- 构建工具：Vite 5
- 数据库：SQLite 3
- 进程管理：PM2 5
- 测试框架：Jest + Vitest

## CLI 命令

### 便捷 Scripts（从根目录运行）
项目在根 `package.json` 中提供了便捷 scripts，可直接运行：

```bash
pnpm start                # 启动代理服务器（PM2 守护）
pnpm status               # 查看服务器状态（CPU / 内存 / 运行时间）
pnpm stop                 # 停止代理服务器
pnpm reload               # 优雅重启服务器（不中断现有请求）
pnpm logs [n]             # 查看最近日志（可选：行数）
pnpm config               # 查看当前配置
pnpm test-connection      # 测试与目标 API 的连通性
pnpm ui                   # 打开 Proxy 管理面板
pnpm admin                # 打开系统管理后台
pnpm cli --help           # 查看所有 CLI 命令
```

### 完整 CLI 命令表
所有命令通过 CLI 执行，构建后路径为 `apps/proxy-core/dist/cli/index.js`。也可以通过 `pnpm cli` 运行。

| 命令 | 描述 | 选项 |
|------|------|------|
| `start` | 启动代理服务器（PM2 守护） | `-p, --port <port>` 临时覆盖端口 |
| `stop` | 停止代理服务器 | 无 |
| `status` | 查看服务器运行状态 | 无 |
| `logs [n]` | 查看最近日志 | `-l, --level <level>` 按级别过滤；`-g, --grep <pattern>` 关键字搜索 |
| `config <action> [key] [value]` | 管理配置（show / set / reset） | 无 |
| `reload` | 优雅重启服务器 | 无 |
| `test` | 测试与目标 API 的连通性 | 无 |
| `ui` | 打开 Proxy 管理面板 | `--build` 强制重新构建 UI |

使用示例：
```bash
# 在 8080 端口启动（覆盖配置）
pnpm cli start --port 8080

# 查看状态
pnpm status

# 查看最近 50 行日志
pnpm logs 50

# 查看最近 error 级别日志
pnpm cli logs -l error

# 搜索包含 "timeout" 的日志
pnpm cli logs -g timeout

# 修改配置
pnpm cli config show
pnpm cli config set proxy.target https://new-endpoint.example.com

# 优雅重启
pnpm reload

# 测试连通性
pnpm test-connection

# 打开 Proxy 管理面板
pnpm ui
```

## 本地开发
```bash
# 安装依赖
pnpm install

# 同时启动 Core（端口 3000） + Proxy UI（端口 3001）
pnpm dev

# 单独启动各应用
pnpm dev:proxy-core       # Core 开发模式（tsx 热重载，端口 3000）
pnpm dev:proxy-cli        # Proxy UI 开发模式（Vite HMR，端口 3001）
pnpm dev:proxy-admin      # Admin UI 开发模式（Vite HMR，端口 3002）
```

## 构建生产版本
```bash
# 构建所有包
pnpm build

# 单独构建
pnpm build:proxy-core     # 构建核心代理服务
pnpm build:proxy-cli      # 构建 Proxy 管理面板
pnpm build:proxy-admin    # 构建系统管理后台
```

## 本地预览生产版本
```bash
pnpm preview:proxy-cli    # 预览 Proxy UI 生产构建
pnpm preview:proxy-admin  # 预览 Admin UI 生产构建
```

## 配置
配置文件位于项目根目录 `config.json`，启动时通过 Zod schema 强制校验。校验失败则服务器不会启动。

### 配置结构
```json
{
  "server": {
    "port": 3000,
    "host": "localhost"
  },
  "proxy": {
    "target": "https://token-plan.cn-beijing.maas.aliyuncs.com/apps/anthropic",
    "changeOrigin": true,
    "rewritePrefix": ""
  },
  "logging": {
    "level": "info",
    "file": "logs/proxy.log"
  },
  "auth": {
    "token": "optional"
  }
}
```

### 配置项说明
| 字段 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| `server.port` | `number` (1-65535) | 是 | `3000` | 代理服务器监听端口 |
| `server.host` | `string` | 是 | `localhost` | 代理服务器监听主机 |
| `proxy.target` | `string` (URL) | 是 | -- | 阿里云中转 API 地址 |
| `proxy.changeOrigin` | `boolean` | 是 | `true` | 是否修改请求 Origin 头 |
| `proxy.rewritePrefix` | `string` | 否 | `""` | 转发时重写的路径前缀 |
| `logging.level` | `enum` (debug/info/warn/error) | 是 | `info` | 日志级别 |
| `logging.file` | `string` | 是 | `logs/proxy.log` | 日志文件路径 |
| `auth.token` | `string` | 否 | -- | Web UI 配置修改 API 的认证 Token |

`auth.token` 为空时，配置修改 API 不需要认证（开发模式）。生产环境务必设置 Token 或通过环境变量 `UI_AUTH_TOKEN` 提供。

### 错误处理
代理服务器针对常见网络错误返回标准 HTTP 状态码：
| 错误码 | HTTP 状态 | 说明 |
|--------|-----------|------|
| `ECONNREFUSED` | 502 | 目标服务器不可达 |
| `ENOTFOUND` | 502 | 目标域名无法解析 |
| `ETIMEDOUT` | 504 | 请求超时 |

所有错误响应包含 `requestId` 字段，用于追踪具体请求。

## Web UI 管理面板

### Proxy 管理面板
通过 `pnpm ui` 命令或直接访问 `http://localhost:3000/ui` 打开。

面板包含四个核心区域：
**状态监控 (StatusPanel)** -- 实时显示服务器运行状态，每 5 秒刷新：
- 运行状态（online / stopped）
- CPU 使用率
- 内存占用
- 运行时间
- 重启次数

**日志查看 (LogViewer)** -- WebSocket 实时日志流：
- 按级别过滤（debug / info / warn / error）
- 关键字搜索
- 暂停 / 恢复 / 清空操作
- 自动滚动到最新日志
- 保留最近 500 条日志

**请求历史 (RequestHistory)** -- 查看完整请求记录：
- 每个请求的 headers、body、响应状态
- SSE 响应 events 数组（message_start、content_block_delta等）
- 响应时间统计
- Token 消耗计算
- 每 5 秒自动刷新

**配置编辑 (ConfigEditor)** -- 可视化配置管理：
- 编辑服务器、代理、日志配置
- Zod 实时校验，错误提示具体字段
- Save / Reset Default 操作
- 供应商配置管理（多 AI 供应商支持）
- 需要认证 Token（如果配置了 `auth.token`）

### 系统管理后台
通过 `pnpm admin` 命令或直接访问 `http://localhost:3000/admin` 打开。

后台包含用户管理、权限控制、全局监控等企业级功能：
- **用户管理**：用户列表、创建/编辑/删除用户、角色分配
- **权限控制**：基于角色的访问控制（RBAC）、权限分配
- **全局监控**：系统级请求统计、性能指标、异常告警
- **系统配置**：全局参数配置、供应商管理、日志配置

## 架构
项目采用 pnpm monorepo 结构，分为 Core、Proxy UI、Admin UI 三个独立应用，共享公共工具包。

### Proxy 转发架构
**应用层转发**（Controller + Fetch + SSE Pipe），而非 @fastify/http-proxy 透明代理。

#### 为什么不用透明代理？
早期版本使用 `@fastify/http-proxy` 透明代理模式，但遇到核心矛盾：
**问题**：透明代理模式下无法同时满足：
- ✓ 记录完整请求 payload（model、messages、tools、MCP 参数）
- ✓ 原样转发 SSE stream（不干扰流式响应）
- ✓ 未来扩展（Token统计、用户鉴权、Prompt审计）

**原因**：
- `@fastify/http-proxy` 内部控制 request stream
- 任何读取 body 的操作都会消耗 stream
- HTTP stream 只能被消费一次

#### 正确架构：应用层转发
当前采用 **Controller + Fetch + SSE Pipe** 架构：
```typescript
fastify.post('/v1/*', async (request, reply) => {
  const payload = request.body  // Fastify 已解析
  
  // 记录完整请求
  await saveRequest({
    headers: request.headers,
    body: payload  // model, messages, tools, max_tokens, etc.
  })
  
  // 应用层转发
  const response = await fetch(targetUrl, {
    method: 'POST',
    headers: filteredHeaders,
    body: JSON.stringify(payload)
  })
  
  // SSE stream 转发
  reply.hijack()
  reply.raw.writeHead(response.status, response.headers)
  
  // Web Stream → Node Stream
  Readable.fromWeb(response.body).pipe(reply.raw)
})
```

#### 请求流程
```
Claude Code Client
       |
       | POST /v1/messages
       | Headers: x-api-key, anthropic-version, accept
       | Body: { model, messages, tools, max_tokens }
       |
       v
  Fastify Server
       |
       |-- 1. Fastify 自动解析 body → JSON object
       |-- 2. saveRequest({ headers, body })  ✓ 完整记录
       |-- 3. filterForwardHeaders()  删除 host/content-length
       |
       v
  fetch(targetUrl)  应用层转发
       |
       |-- Headers: x-api-key, anthropic-version, accept (原样透传)
       |-- Body: JSON.stringify(payload)  重新序列化
       |
       v
  Aliyun API
       |
       |-- Response: SSE stream (Web ReadableStream)
       |
       v
  reply.hijack()  接管响应
       |
       |-- Readable.fromWeb(response.body)  Web → Node Stream
       |-- pipe(reply.raw)  SSE 原样流向客户端
       |
       v
  Claude Code Client  ✓ 流式响应正常
```

## 环境变量配置

### proxy-admin 环境变量：
- `.env`：公共环境变量，提交到git
- `.env.local`：本地开发环境变量，不提交git，可从`.env.local.example`复制修改

主要配置项：
- `VITE_API_PREFIX`：API接口前缀，默认`/api`
- `VITE_API_PROXY_TARGET`：本地开发API代理目标地址

### proxy-cli 环境变量：
- `.env`：公共环境变量，提交到git
- `.env.local`：本地开发环境变量

主要配置项：
- `VITE_API_BASE`：API基础地址，默认`/ui/api`

## 目录说明

### proxy-core
```
apps/proxy-core/src/
├── cli/              # Commander CLI 入口
│   ├── index.ts      # 命令注册
│   └── commands/     # 各命令实现
├── server/           # Fastify 服务器
│   ├── index.ts      # 服务器创建与启动
│   ├── proxy.ts      # 代理转发核心
│   ├── ui-route.ts   # UI API + WebSocket + 静态资源
│   ├── providers-route.ts  # 供应商 API
│   └── middleware/   # 中间件
├── config/           # 配置加载与校验
│   ├── index.ts      # load / save / reset
│   └── schema.ts     # Zod schema 定义
├── logger/           # Pino 日志
│   └── index.ts      # 日志创建
├── types/            # 类型定义
└── utils/            # 工具函数
    ├── pm2.ts        # PM2 操作封装
    ├── providers-db.ts  # 供应商 SQLite 操作
    └── esm-dirname.ts   # ESM __dirname 替代
```

### proxy-cli
```
apps/proxy-cli/src/
├── components/       # 业务公共组件
│   ├── StatusPanel.tsx    # 状态监控面板
│   ├── LogViewer.tsx      # 实时日志查看器
│   ├── RequestHistory.tsx # 请求历史面板
│   ├── ConfigEditor.tsx   # 配置编辑器
│   └── ProviderManagerModal.tsx  # 供应商管理
├── hooks/            # 自定义 hooks
│   ├── useStatus.ts  # 状态轮询 hook
│   ├── useLogs.ts    # WebSocket 日志 hook
│   └── useRequestHistory.ts  # 请求历史 hook
├── api/              # HTTP API 调用封装
├── types/            # 类型定义
├── App.tsx           # 根组件
└── main.tsx          # 入口文件
```

### proxy-admin
```
apps/proxy-admin/src/
├── components/  # 业务公共组件
├── pages/       # 页面组件
│   ├── user/    # 用户管理
│   ├── role/    # 角色管理
│   ├── monitor/ # 全局监控
│   └── system/  # 系统配置
├── router/      # 路由配置
├── services/    # API请求封装
├── utils/       # 项目内工具函数
├── stores/      # 状态管理
├── styles/      # 全局样式
├── App.tsx      # 根组件
└── main.tsx     # 入口文件
```

### packages/utils
公共工具包，可跨所有子项目复用，使用方式：
```typescript
import { formatDate, debounce } from '@cc/utils';
```

## 测试
```bash
# 运行所有测试
pnpm test

# Core 测试（Jest）
pnpm --filter @cc-monitoring/cli-core test

# Proxy UI 测试（Vitest）
pnpm --filter @cc-monitoring/cli test

# Admin UI 测试（Vitest）
pnpm --filter proxy-admin test

# UI 测试 watch 模式
pnpm --filter proxy-admin test:watch
```

Core 包测试覆盖：配置校验、日志创建、代理转发、服务器启动、API 路由、中间件、PM2 操作。

UI 包测试覆盖：组件渲染、交互逻辑、自定义 hooks、API 调用封装。

## 开发规范
1. 公共工具函数优先提取到 `packages/utils` 目录
2. 业务组件按业务模块划分，通用组件放到 `src/components`
3. API请求统一使用 `src/services/request.ts` 封装的axios实例
4. 环境变量统一在 `.env` 和 `.env.local` 配置，类型声明在 `src/vite-env.d.ts`
5. 代码遵循TypeScript严格模式要求
6. 提交信息格式：`type: description`（type: feat/fix/docs/style/refactor/test/chore）

## 常见问题
**Q: 启动时报配置校验错误**
确保 `config.json` 符合 Zod schema。所有必填字段不能缺失，`server.port` 必须在 1-65535 范围内，`proxy.target` 必须是合法 URL。用 `pnpm config` 查看当前配置。

**Q: 代理转发返回 502**
用 `pnpm test-connection` 检查与目标 API 的连通性。常见原因：网络不可达、DNS 无法解析、阿里云服务端点变更。

**Q: Web UI 配置修改返回 401**
配置了 `auth.token` 但请求未携带 `Authorization` 头。请求时添加 `Bearer <token>` 头，或通过环境变量 `UI_AUTH_TOKEN` 设置 Token。

**Q: 日志面板没有数据**
检查 `logging.file` 配置的路径是否存在且可读。项目根目录已创建 `logs/` 文件夹。

**Q: 本地开发时 Proxy UI 无法连接到 API**
确保 proxy-core 服务已启动（端口 3000），proxy-cli 的 `VITE_API_BASE` 配置正确。

## 贡献
1. Fork 本仓库
2. 创建特性分支：`git checkout -b feature/my-feature`
3. 提交改动：确保新增功能有对应测试
4. 推送分支：`git push origin feature/my-feature`
5. 创建 Pull Request

代码风格遵循 TypeScript strict 模式。

## 许可
MIT License - 详见 [LICENSE](LICENSE) 文件。

<!-- Badge placeholders -->
[build-badge]: https://img.shields.io/badge/build-passing-brightgreen
[coverage-badge]: https://img.shields.io/badge/coverage-80%25-green
[license-badge]: https://img.shields.io/badge/License-MIT-yellow.svg

[build-link]: https://github.com/your-org/cc-monitoring/actions
[coverage-link]: https://github.com/your-org/cc-monitoring/actions
[license-link]: https://opensource.org/licenses/MIT

# proxy-admin / 环境与构建

## 本文档覆盖的源文件

- `apps/proxy-admin/vite.config.ts`
- `apps/proxy-admin/tsconfig.json` / `tsconfig.node.json`
- `apps/proxy-admin/tailwind.config.js`
- `apps/proxy-admin/postcss.config.js`
- `apps/proxy-admin/src/vite-env.d.ts`
- `apps/proxy-admin/package.json`

## Vite 配置

`apps/proxy-admin/vite.config.ts`：

```ts
export default defineConfig({
  plugins: [
    react(),
    viteMockServe({
      mockPath: 'src/mock',
      enable: true,        // 开发时启用 mock
      logger: true
    })
  ],
  resolve: {
    alias: { '@': resolve(__dirname, 'src') }
  },
  server: {
    port: 3000,
    proxy: {
      '/api': {
        target: process.env.VITE_API_PROXY_TARGET || 'http://localhost:8080',
        changeOrigin: true
      }
    }
  }
})
```

### 三个关键配置

- **`viteMockServe`**：`vite-plugin-mock`，从 `src/mock/**` 加载 `MockMethod[]` 数组。`logger: true` 让 mock 请求打印到 dev 控制台
- **别名 `@`**：`@/components/*` 等价于 `src/components/*`——但代码里未见使用（组件都用相对路径 import）
- **dev proxy**：`/api/*` 反代到 `VITE_API_PROXY_TARGET`（默认 `http://localhost:8080`）——**注意 mock 优先级高于 proxy**：`vite-plugin-mock` 在中间件链前面，命中就走 mock；未命中才走 proxy

### 端口冲突

- proxy-admin 默认 port 3000
- proxy-cli 老版本 dev proxy 目标也是 3000（`apps/proxy-cli/vite.config.ts:15`）
- **两者同时开发时必须改端口**（proxy-admin 一方）

## 环境变量

### 类型声明

`apps/proxy-admin/src/vite-env.d.ts`：

```ts
/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_PREFIX: string
  readonly VITE_API_PROXY_TARGET: string
}

interface ImportMeta { readonly env: ImportMetaEnv }
```

Vite 约定：以 `VITE_` 开头的环境变量才会注入到客户端代码。

### 变量说明

| 变量 | 默认值 | 作用 |
|---|---|---|
| `VITE_API_PREFIX` | `/api` | axios 实例 baseURL（`request.ts:6`） |
| `VITE_API_PROXY_TARGET` | `http://localhost:8080` | Vite dev proxy 转发目标（vite.config.ts:24） |

### 文件约定

- `.env`：全项目公共变量（进 git）
- `.env.local`：本地开发变量（不进 git，从 `.env.local.example` 复制）
- `.env.development` / `.env.production`：模式特定

（当前仓库未见实际 `.env*` 文件，需按需创建。）

## Tailwind 配置

`apps/proxy-admin/tailwind.config.js`：

```js
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: { extend: {} },
  plugins: [],
  corePlugins: {
    preflight: false    // 禁用 preflight，避免与 Ant Design 冲突
  }
}
```

**关键决策**：`preflight: false`。Tailwind 的 preflight 会 reset 默认样式（`ul`、`h1`、`button` 等），与 Ant Design 的组件样式冲突（例如 `button` 默认样式被清零 → antd Button 依赖的伪类失效）。禁用后由 antd 自己的 base styles 接管。

## PostCSS 配置

`apps/proxy-admin/postcss.config.js`（未详读）：Tailwind 3 + Autoprefixer 组合，标准配置。

## TypeScript 配置

`apps/proxy-admin/tsconfig.json`（未详读，但结构大致）：

- `extends: '../../tsconfig.base.json'`
- `include: ["src", "vite.config.ts"]` 或类似
- `references: [{ path: "./tsconfig.node.json" }]`（Vite 项目常见拆分）

`tsconfig.node.json` 用于 `vite.config.ts` 自身的类型检查（Node 环境，`allowSyntheticDefaultImports` 等）。

## 依赖清单

`apps/proxy-admin/package.json`：

### dependencies

- `react` / `react-dom` ^18.2
- `react-router-dom` ^6.20
- `antd` ^5.12
- `axios` ^1.6
- `@ant-design/icons` ^5.2
- `@cc/utils` `workspace:^1.0.0`

### devDependencies

- `@types/react` / `@types/react-dom`
- `@vitejs/plugin-react` ^4.2
- `autoprefixer` ^10.4
- `mockjs` ^1.1
- `postcss` ^8.4
- `tailwindcss` ^3.3
- `typescript` ^5.3
- `vite` ^5.0
- `vite-plugin-mock` ^3.0

**说明**：
- Tailwind 版本是 **3**（proxy-cli 用的是 **4**）—— 两个应用主动选择不同版本
- **`@cc/utils`**：workspace 引用；当前实际未导入使用（`packages/utils` 只有 formatDate/debounce 示例函数）

## 构建脚本

`package.json` scripts：

```json
{
  "dev": "vite",
  "build": "tsc && vite build",
  "preview": "vite preview"
}
```

- **`build`**：先 `tsc`（严格类型检查，无产物；`noEmit` 由 tsconfig 控制），再 `vite build`
- **`preview`**：本地预览 build 产物

## 未来接入 proxy-core 的步骤

（重复自 [services-and-mock.md](./services-and-mock.md#后端联调思路未来)）

1. `.env.local` 写 `VITE_API_PROXY_TARGET=http://localhost:9527`
2. `.env` 或 `.env.production` 写 `VITE_API_PREFIX=/ui/api`（与 proxy-core 一致）
3. `viteMockServe.enable = false`（或按 `mode !== 'development'` 条件禁用）
4. 后端补齐管理域端点（用户 / 供应商全局 / 系统设置）
5. 实现真实登录 → 拿到 token → proxy-core 校验 `Bearer <token>` 对应 `config.auth.token`

## 相关

- 服务层 → [services-and-mock.md](./services-and-mock.md)
- 认证 → [routing-and-auth.md](./routing-and-auth.md)

# proxy-admin

## 本文档覆盖的源文件

- `apps/proxy-admin/package.json`
- `apps/proxy-admin/vite.config.ts`
- `apps/proxy-admin/tsconfig.json` / `tsconfig.node.json`
- `apps/proxy-admin/tailwind.config.js`
- `apps/proxy-admin/postcss.config.js`
- `apps/proxy-admin/src/**/*.{ts,tsx}`

## 模块角色

`proxy-admin` 是**面向管理员的 SaaS 后台**（规划形态）。目标包括：用户管理、权限控制（RBAC）、全局请求监控、系统级配置、供应商全局管理。

**当前实现状态**：脚手架 + Mock 数据阶段。全部接口走 `vite-plugin-mock` 生成的假数据，**尚未接入 proxy-core**。

三个页面已有基本 CRUD 骨架（Login / User / Supplier / SystemSettings），两个页面是 TODO 占位（Dashboard 静态数字、LogManagement `<Empty>` 组件）。

## 与 proxy-cli 的分工

| 维度 | proxy-cli | proxy-admin |
|---|---|---|
| 用户 | 单机开发者 | 运营/管理员 |
| 数据来源 | proxy-core 真实数据 | 目前 Mock |
| UI 库 | 原生 + Tailwind + Recharts | Ant Design 5 + Tailwind |
| 部署 | 由 proxy-core 静态托管 | 独立 Vite 项目 |
| 路由 | 无（单页） | React Router v6 |
| 认证 | Bearer Token（可选） | localStorage token + 路由守卫 |
| API 层 | 原生 fetch | axios 实例 + 拦截器 |
| 特有功能 | 请求历史、Compare、Provider 表格 | 用户管理、RBAC、系统设置 |

**目前 proxy-admin 与 proxy-core 无实际集成**——`.env` 默认 `VITE_API_PROXY_TARGET=http://localhost:8080`，端口都对不上 proxy-core 的 9527/3000。所有 API 都是 mock 路径 `/api/*`（后端也不存在）。

## 目录布局

```
apps/proxy-admin/
├── package.json          # antd, axios, react-router-dom, vite-plugin-mock, mockjs
├── vite.config.ts        # port 3000, viteMockServe mockPath 'src/mock'
├── tsconfig.json / tsconfig.node.json
├── tailwind.config.js    # preflight: false (与 antd 冲突)
├── postcss.config.js
└── src/
    ├── main.tsx          # AuthProvider + antd ConfigProvider(zhCN) + Router
    ├── App.tsx           # 只包 <Router />
    ├── vite-env.d.ts     # VITE_API_PREFIX / VITE_API_PROXY_TARGET
    ├── router/
    │   ├── index.tsx     # createBrowserRouter 定义路由
    │   └── guard.ts      # authLoader / publicLoader
    ├── contexts/
    │   └── AuthContext.tsx  # useReducer 管理 token/user
    ├── layouts/
    │   └── MainLayout.tsx   # Sider + Header + Content + Dropdown
    ├── pages/
    │   ├── Login.tsx        # 玻璃拟态登录页
    │   ├── Dashboard.tsx    # 静态卡片 + TODO 占位
    │   ├── UserManagement.tsx
    │   ├── SupplierManagement.tsx
    │   ├── LogManagement.tsx    # 空
    │   └── SystemSettings.tsx
    ├── services/
    │   ├── request.ts       # axios 实例 + 请求/响应拦截
    │   └── api.ts           # 所有接口 + 类型
    ├── mock/
    │   ├── index.ts         # 合并三个 mock 模块
    │   ├── user.ts          # login/logout/user list
    │   ├── supplier.ts      # supplier list/create
    │   └── system.ts        # system settings
    ├── types/
    │   └── auth.ts          # UserInfo / AuthState / LoginParams / AuthContextType
    ├── utils/
    │   └── index.ts         # getLocalStorage / setLocalStorage
    └── styles/
        └── global.css       # (存在但未读取)
```

## 技术栈

- **React 18** + **TypeScript 5**
- **Vite 5**（`vite-plugin-mock` + `mockjs`）
- **React Router v6**（`createBrowserRouter` + loader 守卫）
- **Ant Design 5** + **@ant-design/icons**（全 antd 组件）
- **axios 1.6**（拦截器统一 401 处理）
- **Tailwind 3**（`preflight: false` 与 antd 兼容）
- **@cc/utils**（workspace）

## 阅读顺序

- [routing-and-auth.md](./routing-and-auth.md) — 路由 + 守卫 + AuthContext
- [layout-and-menu.md](./layout-and-menu.md) — MainLayout 结构
- [pages.md](./pages.md) — 6 个页面
- [services-and-mock.md](./services-and-mock.md) — axios 拦截 + mock 数据
- [env-and-build.md](./env-and-build.md) — 环境变量 + Vite 构建

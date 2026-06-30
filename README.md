# CC Monitoring 前端项目

## 项目结构
本项目采用pnpm monorepo架构：
```
.
├── apps/             # 应用目录
│   └── proxy-admin/  # Proxy管理后台
├── packages/         # 公共包目录
│   └── utils/        # 通用工具函数
├── docs/             # 文档目录
├── package.json
├── pnpm-workspace.yaml
└── tsconfig.base.json
```

## 技术栈
- 包管理器：pnpm 8+
- 主框架：React 18 + TypeScript 5
- 路由：React Router v6
- UI组件库：Ant Design v5
- HTTP客户端：Axios
- 构建工具：Vite 5
- Node版本：>= 18.0.0

## 快速开始

### 环境准备
- 安装 Node.js >= 18.0.0
- 安装 pnpm >= 8.0.0
  ```bash
  npm install -g pnpm
  ```

### 安装依赖
```bash
pnpm install
```

### 启动开发服务
```bash
# 启动proxy-admin
pnpm dev:proxy-admin
```
访问：http://localhost:3000

### 构建生产版本
```bash
# 构建proxy-admin
pnpm build:proxy-admin
```
构建产物在 `apps/proxy-admin/dist` 目录

### 本地预览生产版本
```bash
pnpm preview:proxy-admin
```

## 环境变量配置
proxy-admin环境变量：
- `.env`：公共环境变量，提交到git
- `.env.local`：本地开发环境变量，不提交git，可从`.env.local.example`复制修改

主要配置项：
- `VITE_API_PREFIX`：API接口前缀，默认`/api`
- `VITE_API_PROXY_TARGET`：本地开发API代理目标地址

## 目录说明

### proxy-admin
```
apps/proxy-admin/src/
├── components/  # 业务公共组件
├── pages/       # 页面组件
├── router/      # 路由配置
├── services/    # API请求封装
├── utils/       # 项目内工具函数
├── stores/      # 状态管理（预留）
├── styles/      # 全局样式
├── App.tsx      # 根组件
└── main.tsx     # 入口文件
```

### packages/utils
公共工具包，可跨所有子项目复用，使用方式：
```typescript
import { formatDate, debounce } from '@cc/utils';
```

## 开发规范
1. 公共工具函数优先提取到 `packages/utils` 目录
2. 业务组件按业务模块划分，通用组件放到 `src/components`
3. API请求统一使用 `src/services/request.ts` 封装的axios实例
4. 环境变量统一在 `.env` 和 `.env.local` 配置，类型声明在 `src/vite-env.d.ts`
5. 代码遵循TypeScript严格模式要求

# 前端Monorepo项目初始化实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 初始化pnpm monorepo架构，完成proxy-admin子项目的基础搭建和配置。

**Architecture:** 采用pnpm workspace管理monorepo，apps目录存放应用项目，packages目录存放公共包。proxy-admin子项目采用React+TypeScript+Vite技术栈，按职责划分目录结构。

**Tech Stack:** pnpm, React 18, TypeScript, React Router v6, Ant Design v5, Axios, Vite 5

## Global Constraints
- 使用pnpm作为包管理器
- 环境变量使用vite内置的dotenv管理，.env提交git，.env.local加入gitignore
- 公共工具函数优先提取到packages/utils目录
- 代码遵循TypeScript最佳实践，启用严格模式

---

### Task 1: 初始化pnpm monorepo基础配置

**Files:**
- Create: `pnpm-workspace.yaml`
- Create: `package.json`
- Create: `tsconfig.base.json`
- Modify: `.gitignore`

**Interfaces:**
- Produces: monorepo基础配置文件，工作空间包含apps和packages目录

- [ ] **Step 1: 创建pnpm-workspace.yaml配置**
```yaml
packages:
  - 'apps/*'
  - 'packages/*'
```

- [ ] **Step 2: 创建根目录package.json**
```json
{
  "name": "cc-monitoring",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev:proxy-admin": "pnpm -F proxy-admin dev",
    "build:proxy-admin": "pnpm -F proxy-admin build",
    "preview:proxy-admin": "pnpm -F proxy-admin preview"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "typescript": "^5.0.0"
  },
  "engines": {
    "node": ">=18.0.0",
    "pnpm": ">=8.0.0"
  }
}
```

- [ ] **Step 3: 创建全局tsconfig.base.json**
```json
{
  "compilerOptions": {
    "target": "ES2020",
    "useDefineForClassFields": true,
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "baseUrl": ".",
    "paths": {
      "@/*": ["apps/proxy-admin/src/*"],
      "@cc/utils": ["packages/utils/src/index.ts"]
    }
  },
  "include": ["src"]
}
```

- [ ] **Step 4: 更新.gitignore文件**
```
# Dependencies
node_modules/
.pnpm/

# Build outputs
dist/
build/

# Environment variables
.env.local
.env.*.local

# IDE
.vscode/
.idea/
*.swp
*.swo
*~

# OS
.DS_Store
Thumbs.db

# Logs
logs/
*.log
npm-debug.log*
pnpm-debug.log*
yarn-debug.log*
yarn-error.log*
```

- [ ] **Step 5: 提交基础配置**
```bash
git add pnpm-workspace.yaml package.json tsconfig.base.json .gitignore
git commit -m "feat: init pnpm monorepo base config"
```

---

### Task 2: 创建packages/utils公共工具包

**Files:**
- Create: `packages/utils/package.json`
- Create: `packages/utils/tsconfig.json`
- Create: `packages/utils/src/index.ts`

**Interfaces:**
- Produces: 可跨子项目复用的公共工具包基础结构

- [ ] **Step 1: 创建packages/utils/package.json**
```json
{
  "name": "@cc/utils",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "main": "src/index.ts",
  "types": "src/index.ts"
}
```

- [ ] **Step 2: 创建packages/utils/tsconfig.json**
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "noEmit": false,
    "outDir": "dist",
    "declaration": true,
    "declarationDir": "dist"
  },
  "include": ["src/**/*"]
}
```

- [ ] **Step 3: 创建packages/utils/src/index.ts，添加示例工具函数**
```typescript
/**
 * 示例工具函数：格式化日期
 */
export const formatDate = (date: Date | string | number, format = 'YYYY-MM-DD HH:mm:ss'): string => {
  const d = new Date(date);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hour = String(d.getHours()).padStart(2, '0');
  const minute = String(d.getMinutes()).padStart(2, '0');
  const second = String(d.getSeconds()).padStart(2, '0');
  
  return format
    .replace('YYYY', String(year))
    .replace('MM', month)
    .replace('DD', day)
    .replace('HH', hour)
    .replace('mm', minute)
    .replace('ss', second);
};

/**
 * 示例工具函数：防抖
 */
export const debounce = <T extends (...args: any[]) => any>(
  func: T,
  wait: number
): ((...args: Parameters<T>) => void) => {
  let timeout: NodeJS.Timeout | null = null;
  return (...args: Parameters<T>) => {
    if (timeout) clearTimeout(timeout);
    timeout = setTimeout(() => func(...args), wait);
  };
};
```

- [ ] **Step 4: 提交公共工具包配置**
```bash
git add packages/utils/
git commit -m "feat: add @cc/utils public package"
```

---

### Task 3: 初始化proxy-admin子项目

**Files:**
- Create: `apps/proxy-admin/package.json`
- Create: `apps/proxy-admin/vite.config.ts`
- Create: `apps/proxy-admin/tsconfig.json`
- Create: `apps/proxy-admin/tsconfig.node.json`
- Create: `apps/proxy-admin/index.html`
- Create: `apps/proxy-admin/src/main.tsx`
- Create: `apps/proxy-admin/src/App.tsx`
- Create: `apps/proxy-admin/src/vite-env.d.ts`

**Interfaces:**
- Produces: proxy-admin子项目基础结构和vite配置

- [ ] **Step 1: 创建apps/proxy-admin/package.json**
```json
{
  "name": "proxy-admin",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "react": "^18.2.0",
    "react-dom": "^18.2.0",
    "react-router-dom": "^6.20.0",
    "antd": "^5.12.0",
    "axios": "^1.6.0",
    "@cc/utils": "workspace:^1.0.0"
  },
  "devDependencies": {
    "@types/react": "^18.2.0",
    "@types/react-dom": "^18.2.0",
    "@vitejs/plugin-react": "^4.2.0",
    "typescript": "^5.3.0",
    "vite": "^5.0.0"
  }
}
```

- [ ] **Step 2: 创建apps/proxy-admin/vite.config.ts**
```typescript
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  server: {
    port: 3000,
    proxy: {
      '/api': {
        target: process.env.VITE_API_PROXY_TARGET || 'http://localhost:8080',
        changeOrigin: true,
      },
    },
  },
});
```

- [ ] **Step 3: 创建apps/proxy-admin/tsconfig.json**
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "target": "ES2020",
    "useDefineForClassFields": true,
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true
  },
  "include": ["src"],
  "references": [{ "path": "./tsconfig.node.json" }]
}
```

- [ ] **Step 4: 创建apps/proxy-admin/tsconfig.node.json**
```json
{
  "compilerOptions": {
    "composite": true,
    "skipLibCheck": true,
    "module": "ESNext",
    "moduleResolution": "bundler",
    "allowSyntheticDefaultImports": true
  },
  "include": ["vite.config.ts"]
}
```

- [ ] **Step 5: 创建apps/proxy-admin/index.html**
```html
<!DOCTYPE html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <link rel="icon" type="image/svg+xml" href="/vite.svg" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Proxy Admin</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 6: 创建apps/proxy-admin/src/vite-env.d.ts**
```typescript
/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_PREFIX: string;
  readonly VITE_API_PROXY_TARGET: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
```

- [ ] **Step 7: 创建apps/proxy-admin/src/main.tsx**
```tsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import { ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import App from './App';
import 'antd/dist/reset.css';
import './styles/global.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ConfigProvider locale={zhCN}>
      <App />
    </ConfigProvider>
  </React.StrictMode>,
);
```

- [ ] **Step 8: 创建apps/proxy-admin/src/App.tsx**
```tsx
import { useState } from 'react';
import { Button, Space, Typography } from 'antd';
import { formatDate } from '@cc/utils';

const { Title, Paragraph } = Typography;

function App() {
  const [count, setCount] = useState(0);

  return (
    <div style={{ padding: '50px', maxWidth: '800px', margin: '0 auto' }}>
      <Title level={2}>Proxy Admin 管理系统</Title>
      <Paragraph>
        当前时间：{formatDate(new Date())}
      </Paragraph>
      <Space size="large">
        <Button type="primary" onClick={() => setCount((count) => count + 1)}>
          count is {count}
        </Button>
        <Button type="default" onClick={() => window.open('https://ant.design', '_blank')}>
          Ant Design 文档
        </Button>
      </Space>
    </div>
  );
}

export default App;
```

- [ ] **Step 9: 创建apps/proxy-admin/src/styles/global.css**
```css
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial,
    'Noto Sans', sans-serif, 'Apple Color Emoji', 'Segoe UI Emoji', 'Segoe UI Symbol',
    'Noto Color Emoji';
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

#root {
  min-height: 100vh;
}
```

- [ ] **Step 10: 提交proxy-admin基础结构**
```bash
git add apps/proxy-admin/
git commit -m "feat: init proxy-admin project base structure"
```

---

### Task 4: 配置环境变量和项目目录结构

**Files:**
- Create: `apps/proxy-admin/.env`
- Create: `apps/proxy-admin/.env.local.example`
- Create: `apps/proxy-admin/src/router/index.tsx`
- Create: `apps/proxy-admin/src/services/request.ts`
- Create: `apps/proxy-admin/src/utils/index.ts`

**Interfaces:**
- Produces: 环境变量配置，路由基础结构，axios请求封装，项目工具目录

- [ ] **Step 1: 创建apps/proxy-admin/.env**
```
# API接口前缀
VITE_API_PREFIX = '/api'

# API代理目标地址（本地开发用，实际部署由nginx代理）
VITE_API_PROXY_TARGET = 'http://localhost:8080'
```

- [ ] **Step 2: 创建apps/proxy-admin/.env.local.example**
```
# 本地开发环境变量，复制为.env.local后修改
VITE_API_PROXY_TARGET = 'http://your-backend-api:port'
```

- [ ] **Step 3: 创建路由目录和基础配置 apps/proxy-admin/src/router/index.tsx**
```tsx
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import App from '../App';

const router = createBrowserRouter([
  {
    path: '/',
    element: <App />,
  },
  {
    path: '/about',
    element: <div>关于页面</div>,
  },
]);

export default function Router() {
  return <RouterProvider router={router} />;
}
```

- [ ] **Step 4: 更新main.tsx使用路由**
修改 `apps/proxy-admin/src/main.tsx`：
```tsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import { ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import Router from './router';
import 'antd/dist/reset.css';
import './styles/global.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ConfigProvider locale={zhCN}>
      <Router />
    </ConfigProvider>
  </React.StrictMode>,
);
```

- [ ] **Step 5: 创建axios请求封装 apps/proxy-admin/src/services/request.ts**
```typescript
import axios from 'axios';

// 创建axios实例
const request = axios.create({
  baseURL: import.meta.env.VITE_API_PREFIX,
  timeout: 10000,
});

// 请求拦截器
request.interceptors.request.use(
  (config) => {
    // 这里可以添加token等认证信息
    // const token = localStorage.getItem('token');
    // if (token) {
    //   config.headers.Authorization = `Bearer ${token}`;
    // }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  },
);

// 响应拦截器
request.interceptors.response.use(
  (response) => {
    return response.data;
  },
  (error) => {
    // 统一错误处理
    console.error('请求错误:', error);
    return Promise.reject(error);
  },
);

export default request;
```

- [ ] **Step 6: 创建项目内工具目录 apps/proxy-admin/src/utils/index.ts**
```typescript
/**
 * 项目内工具函数，可在这里添加
 */

// 示例：获取localStorage
export const getLocalStorage = <T = any>(key: string, defaultValue?: T): T | null => {
  try {
    const value = localStorage.getItem(key);
    if (value === null) {
      return defaultValue ?? null;
    }
    return JSON.parse(value) as T;
  } catch (error) {
    console.error(`读取localStorage ${key} 失败:`, error);
    return defaultValue ?? null;
  }
};

// 示例：设置localStorage
export const setLocalStorage = <T = any>(key: string, value: T): void => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    console.error(`写入localStorage ${key} 失败:`, error);
  }
};
```

- [ ] **Step 7: 创建空目录结构**
```bash
mkdir -p apps/proxy-admin/src/{components,pages,stores}
```

- [ ] **Step 8: 提交配置**
```bash
git add apps/proxy-admin/
git commit -m "feat: add env config, router, axios request wrapper"
```

---

### Task 5: 安装依赖并测试项目运行

**Files:**
- Modify: `pnpm-lock.yaml`（自动生成）

**Interfaces:**
- Produces: 可正常运行的proxy-admin项目

- [ ] **Step 1: 安装依赖**
```bash
pnpm install
```

- [ ] **Step 2: 测试开发服务启动**
```bash
pnpm dev:proxy-admin
# 预期：服务在http://localhost:3000启动，页面正常显示
```

- [ ] **Step 3: 测试生产构建**
```bash
pnpm build:proxy-admin
# 预期：在apps/proxy-admin/dist目录生成构建产物
```

- [ ] **Step 4: 提交依赖锁文件**
```bash
git add pnpm-lock.yaml
git commit -m "chore: add pnpm lock file"
```

---

### Task 6: 编写README.md和更新CLAUDE.md

**Files:**
- Create: `README.md`
- Modify: `CLAUDE.md`

**Interfaces:**
- Produces: 完整的项目说明文档和规范文档

- [ ] **Step 1: 创建README.md**
```markdown
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
```

- [ ] **Step 2: 更新CLAUDE.md**
在原文件基础上添加项目规范部分：
```markdown
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

### 开发流程规范
1. 开发前拉取最新main分支代码
2. 创建功能分支进行开发
3. 开发完成后提交PR，代码review后合并到main分支
```

- [ ] **Step 3: 提交文档**
```bash
git add README.md CLAUDE.md
git commit -m "docs: add README.md and update CLAUDE.md"
```

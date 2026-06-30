# 前端Monorepo项目初始化设计文档

## 项目概述
初始化cc-monitoring前端项目，采用pnpm monorepo架构，包含proxy-admin子项目。

## 技术栈
- 包管理器：pnpm
- 主框架：React 18 + TypeScript
- 路由：React Router v6
- UI组件库：Ant Design v5
- HTTP客户端：Axios
- 构建工具：Vite 5
- 环境变量管理：dotenv（vite内置）

## 项目结构
```
cc-monitoring/
├── packages/                    # 公共包目录
│   └── utils/                   # 通用工具函数（可跨子项目复用）
├── apps/                        # 应用目录
│   └── proxy-admin/             # proxy-admin 子项目
│       ├── src/
│       │   ├── components/      # 业务公共组件
│       │   ├── pages/           # 页面组件
│       │   ├── router/          # 路由配置
│       │   ├── services/        # API 请求封装
│       │   ├── utils/           # 项目内工具函数
│       │   ├── stores/          # 状态管理（预留，按需引入）
│       │   ├── styles/          # 全局样式
│       │   ├── App.tsx
│       │   └── main.tsx
│       ├── index.html
│       ├── vite.config.ts
│       ├── tsconfig.json
│       ├── .env                 # 公共环境变量（接口前缀等，提交git）
│       └── .env.local           # 本地环境变量（敏感信息，不提交git）
├── .gitignore
├── package.json
├── pnpm-workspace.yaml          # pnpm monorepo 配置
├── tsconfig.base.json           # 全局 tsconfig 基础配置
├── CLAUDE.md                    # 项目规范文档
└── README.md                    # 项目说明文档
```

## 环境变量配置
- `.env`：公共配置，如 `VITE_API_PREFIX = '/api'`，提交到git
- `.env.local`：本地开发配置，如代理地址、密钥等，加入.gitignore
- 环境变量使用vite内置的import.meta.env访问，类型声明在src/vite-env.d.ts中定义

## 代码复用规范
1. 跨子项目通用工具函数放到 `packages/utils/` 目录，可独立发布
2. proxy-admin内部通用工具放到 `src/utils/` 目录
3. API请求统一封装到 `src/services/` 目录，使用统一的axios实例配置拦截器
4. 公共业务组件放到 `src/components/` 目录

## 下一步实施计划
1. 初始化pnpm monorepo配置
2. 创建proxy-admin子项目，配置vite+react+ts
3. 安装依赖（react-router、antd、axios等）
4. 配置环境变量
5. 封装axios请求实例
6. 配置路由基础结构
7. 编写README.md文档
8. 更新CLAUDE.md项目规范

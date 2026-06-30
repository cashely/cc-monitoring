# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository Status
Empty. No code files or commits exist in the repository as of 2026/06/30.

## Common Commands
*To be added once build, lint, test, and development workflows are defined.*

## Architecture
*To be added once codebase structure and high-level design are established.*

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
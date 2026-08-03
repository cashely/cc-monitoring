# CLAUDE.md

Claude Code 行为准则 + 编码约束。项目介绍、命令、架构详见 [README.md](README.md)。

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

## Coding Constraints

项目介绍、功能特性、命令速查、项目结构、技术栈、配置详解、目录说明 → 见 [README.md](README.md)。
以下仅列出编码时必须遵守的约束。

### ESM Rules
- 全局 `"type": "module"`，相对导入必须 `.js` 扩展名
- 入口点用 `import.meta.url` guard（非 `require.main === module`）
- PM2 配置必须 `.cjs` 扩展名
- CJS 包通过 `createRequire(import.meta.url)` 加载

### Key Design Decisions（影响编码）
1. **ESM dirname**: `utils/esm-dirname.ts` 计算 `__dirname` 等价物
2. **PM2 ESM**: `createRequire(import.meta.url)` 加载 CJS 包
3. **ecosystem.config.cjs**: `.cjs` 扩展名（全局 `"type": "module"`）
4. **Data dir**: 运行时数据存 `~/.cc-monitoring/`，项目根不含运行时数据
5. **Type casts**: `PinoLike = any`（Fastify/pino 类型不匹配）
6. **Providers**: 存 SQLite 非 config.json，全量替换保存模式
7. **Proxy 架构**: 应用层转发，非透明代理 — 见 [README.md](README.md) 架构说明

### proxy-cli UI 约束
调整 UI 前，先读 [README.md](README.md)「主题配置」章节 + `apps/proxy-cli/src/index.css`。
- 颜色：`var(--color-*)`，禁止硬编码
- 玻璃态：`.glass` / `.glass-strong`
- 字体：正文 12px（`text-xs`），标题 `text-sm` / `text-base`
- 主题：必须支持暗黑/亮色（`.light` class）
- Ant Design：ConfigProvider `fontSize: 12`

### Important Files
- `apps/proxy-core/src/server/proxy.ts` — Proxy 转发核心
- `apps/proxy-core/src/server/ui-route.ts` — UI API + WebSocket + 静态资源
- `apps/proxy-core/src/server/providers-route.ts` — 供应商 REST API
- `apps/proxy-core/src/utils/providers-db.ts` — 供应商 SQLite 数据层
- `apps/proxy-core/src/cli/index.ts` — CLI 命令注册
- `apps/proxy-core/src/utils/pm2.ts` — PM2 操作封装
- `apps/proxy-cli/src/components/ProviderManagerModal.tsx` — 供应商管理 UI

---

## 开发流程规范

1. 收到任务先做需求分析
2. 方案必须跟用户确认再执行
3. 编码前确保工作区改动已提交
4. 不做超出需求的变更，最小修改原则
5. 编码完成后必须 code review，未 review 不提交
6. 前端项目 review 后必须构建验证，构建失败不提交

## 工作步骤
对于用户给到你的任何信息跟问题，你需要严格遵守以下工作流程：
**步骤一** 理解用户提出的问题，给到用户你的理解，跟用户对齐你们理解的一致性
**步骤二** 在需求理解一致性的基础上提出你的解决方案，说明解决方案的时候如果是多个方案，要明确告知不同方案的优缺点跟风险点
**步骤三** 在执行任何编码变动之前，必须拆分成方案、目标、校验标准，然后分派不同的子Agent进行具体工作的执行，禁止主Agent执行编码修改
**步骤四** 在子Agent执行完成以后，主Agent必须从方案、目标以及执行结果对编码进行确认，不允许出现方案以及目标之外的修改处理，确保目标跟结果一致性
**步骤五** 在所有任务完成以后由主Agent进行修改汇总，给到用户确认，只有经过用户的确认才算完成任务
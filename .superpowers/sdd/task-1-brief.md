### Task 1: 安装 @ant-design/x 依赖

**Files:**
- Modify: `apps/proxy-cli/package.json`

**Interfaces:**
- Consumes: none
- Produces: @ant-design/x 可用，后续 Task 使用 Bubble/Bubble.List/Sender 组件

- [ ] **Step 1: 安装依赖**

```bash
cd /Users/cashely.shi/Documents/projects/cc-monitoring
pnpm --filter @cc-monitoring/proxy-cli add @ant-design/x
```

- [ ] **Step 2: 确认安装成功**

```bash
cat apps/proxy-cli/package.json | grep "@ant-design/x"
```

Expected: `@ant-design/x` 出现在 dependencies 中

- [ ] **Step 3: Commit**

```bash
git add apps/proxy-cli/package.json apps/proxy-cli/pnpm-lock.yaml
git commit -m "chore: add @ant-design/x dependency"
```

---


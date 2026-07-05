# packages/utils

## 本文档覆盖的源文件

- `packages/utils/src/index.ts`
- `packages/utils/package.json`
- `packages/utils/tsconfig.json`

## 模块角色

跨应用共享工具包，包名 `@cc/utils`，workspace 依赖形式：

```json
"@cc/utils": "workspace:^1.0.0"
```

pnpm-workspace.yaml 的 `packages/*` 通配符自动纳入。

**当前实现**：仅有两个示例函数，属于**骨架状态**：

## 现有导出

`packages/utils/src/index.ts`：

### `formatDate(date, format?)`

```ts
export const formatDate = (
  date: Date | string | number,
  format = 'YYYY-MM-DD HH:mm:ss'
): string => {
  const d = new Date(date)
  const year = d.getFullYear()
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  // ... hour / minute / second
  return format
    .replace('YYYY', String(year))
    .replace('MM', month)
    .replace('DD', day)
    .replace('HH', hour)
    .replace('mm', minute)
    .replace('ss', second)
}
```

- 简单 token 替换（不支持转义、不支持其他格式）
- 与 proxy-cli 的 `utils/format-time.ts` 功能重叠——**目前 proxy-cli 不用它**，各自实现
- 与 proxy-admin 也无实际引用

### `debounce(func, wait)`

```ts
export const debounce = <T extends (...args: any[]) => any>(
  func: T,
  wait: number
): ((...args: Parameters<T>) => void) => {
  let timeout: NodeJS.Timeout | null = null
  return (...args: Parameters<T>) => {
    if (timeout) clearTimeout(timeout)
    timeout = setTimeout(() => func(...args), wait)
  }
}
```

- 标准防抖
- 泛型约束 `T extends (...args) => any` 保留参数类型
- `NodeJS.Timeout`：类型来自 `@types/node`，但函数在浏览器/Node 都能跑

## 引用情况

- `apps/proxy-admin/package.json` 依赖 `@cc/utils`，但代码中**未 import**
- `apps/proxy-core` 和 `apps/proxy-cli` **不依赖**

即：包被声明但未被消费。

## 定位规划

`CLAUDE.md` 明确写了：

> 公共工具函数：跨项目复用的放到 `packages/utils`，项目内复用的放到对应项目的 `src/utils`

所以未来的候选：

- **跨端时间格式化**（当前 proxy-cli 和 formatDate 重叠）
- **数字格式化**（compact number 等）
- **通用类型工具**（`Nullable<T>`、`Optional<T, K>` 等）
- **API 响应通用类型**（`ApiResponse<T>` 目前只在 proxy-admin 定义）
- **通用 fetch 封装**（重试、超时、错误规范化）

## package.json

`packages/utils/package.json`：

```json
{
  "name": "@cc/utils",
  "version": "1.0.0",
  "type": "module",
  ...
}
```

标准 ESM 包声明。

## 相关

- proxy-cli 的类似工具（各自实现） → [../proxy-cli/utils-and-i18n.md](../proxy-cli/utils-and-i18n.md)
- proxy-admin 的 utils（localStorage 封装） → [../proxy-admin/services-and-mock.md](../proxy-admin/services-and-mock.md#工具函数-utilsindexts)

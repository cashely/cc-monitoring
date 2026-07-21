# proxy-admin / 服务层与 Mock

## 本文档覆盖的源文件

- `apps/proxy-admin/src/services/request.ts`
- `apps/proxy-admin/src/services/api.ts`
- `apps/proxy-admin/src/mock/index.ts`
- `apps/proxy-admin/src/mock/user.ts`
- `apps/proxy-admin/src/mock/supplier.ts`
- `apps/proxy-admin/src/mock/system.ts`
- `apps/proxy-admin/src/utils/index.ts`

## axios 实例 `request.ts`

`apps/proxy-admin/src/services/request.ts`：

```ts
const instance = axios.create({
  baseURL: import.meta.env.VITE_API_PREFIX || '/api',
  timeout: 10000
})

const request = <T = any>(config: AxiosRequestConfig): Promise<T> => instance(config) as unknown as Promise<T>

// 快捷方法：request.get / post / put / delete
request.get = <T>(url, config?) => request({ ...config, method: 'GET', url })
request.post = <T>(url, data?, config?) => request({ ...config, method: 'POST', url, data })
// ...

// 请求拦截：附 token
instance.interceptors.request.use(config => {
  const token = localStorage.getItem('token')
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

// 响应拦截：解包 + 401 处理
instance.interceptors.response.use(
  response => response.data,     // 只返 data
  error => {
    if (error.response?.status === 401) {
      message.error('登录已过期，请重新登录')
      localStorage.removeItem('token')
      localStorage.removeItem('user')
      window.location.href = '/login'
    } else if (error.response?.data?.message) {
      message.error(error.response.data.message)
    } else {
      message.error('请求失败，请稍后重试')
    }
    return Promise.reject(error)
  }
)
```

### 特点

- **baseURL** 来自 `VITE_API_PREFIX`（默认 `/api`），与 vite-plugin-mock 的路径匹配
- **timeout 10s**
- **响应拦截自动解包**：`response.data` 直接返回。调用方拿到的是后端 body 而非 axios `{ data, headers, ... }` 包装
- **401 硬跳转**：`window.location.href = '/login'` 走完整重载，触发 AuthProvider 重新读 localStorage
- **429/500 等其他错误**：`message.error` 显示 antd 全局提示
- **仍然 reject**：调用方的 `catch` 会执行；但 UI 提示已完成

### 类型上的小坑

```ts
return instance(config) as unknown as Promise<T>
```

拦截器返回 `response.data`，但 axios 类型定义仍认为返回 `AxiosResponse<T>`。用 `as unknown as Promise<T>` 强转。调用方类型是 `Promise<ApiResponse<T>>`（业务包装）。

## API 定义 `api.ts`

`apps/proxy-admin/src/services/api.ts`。定义 9 个 API + 3 组类型：

### 通用响应类型

```ts
export interface ApiResponse<T = any> {
  code: number      // 0 = 成功，其他 = 错误
  message: string
  data: T
}
```

所有 mock 都返回这个结构。

### 认证 API

```ts
login(params: LoginParams): Promise<ApiResponse<{ token, user }>>
logout(): Promise<ApiResponse<{ success }>>
getUserInfo(): Promise<ApiResponse<{ user }>>   // 未见调用
```

### 用户管理 API

```ts
getUserList(params?: { page?, pageSize? }): Promise<ApiResponse<{ list: UserInfo[], total }>>
createUser(params: Omit<UserInfo, 'id'>): Promise<ApiResponse<UserInfo>>
```

### 供应商 API

```ts
interface Supplier { id, name, type, status: 'active'|'inactive', config: Record<string, any>, createdAt }
getSupplierList(params?): Promise<ApiResponse<{ list, total }>>
createSupplier(params: Omit<Supplier, 'id' | 'createdAt'>): Promise<ApiResponse<Supplier>>
```

### 系统设置 API

```ts
interface SystemSettings { siteName, siteDescription, maxUploadSize, enableRegistration }
getSystemSettings(): Promise<ApiResponse<SystemSettings>>
saveSystemSettings(params: SystemSettings): Promise<ApiResponse<{ success }>>
```

**注意**：无编辑用户 / 删除用户 / 编辑供应商 / 删除供应商 / 分页 / 搜索接口——UI 里的按钮都没绑 handler。

## Mock 数据

`apps/proxy-admin/src/mock/index.ts`：

```ts
import userMock from './user'
import supplierMock from './supplier'
import systemMock from './system'

export default [...userMock, ...supplierMock, ...systemMock]
```

`vite-plugin-mock` 期待默认导出 `MockMethod[]`。

### user mock

`apps/proxy-admin/src/mock/user.ts`。3 个 mock 用户 + 3 个 API：

- `POST /api/login`：body `{ username, password }`
  - `admin` / `123456` → 返回 token（`mock-token-<Date.now()>`） + `mockUsers[0]`
  - 其他 → `{ code: 401, message: '用户名或密码错误' }`
- `POST /api/logout`：直接返回成功
- `GET /api/user/info`：检查 `Authorization: Bearer ...` 头，否则 401
- `GET /api/user/list`：读 query `page/pageSize`，切片返回

### supplier mock

`apps/proxy-admin/src/mock/supplier.ts`。3 个 mock 供应商（OpenAI / Anthropic / Google Gemini）：

- `GET /api/supplier/list`：分页切片
- `POST /api/supplier`：新增，`id = length + 1`，`createdAt = new Date().toISOString()`

**mock 有状态**：`mockSuppliers.push(newSupplier)` 修改内存中的数组——同一 Vite 开发会话内新增可见。刷新页面丢失。

### system mock

`apps/proxy-admin/src/mock/system.ts`：

- `GET /api/system/settings`：返回 `mockSettings`
- `POST /api/system/settings`：`Object.assign(mockSettings, body)` 就地更新

## 工具函数 `utils/index.ts`

`apps/proxy-admin/src/utils/index.ts`。两个 localStorage 封装：

```ts
export const getLocalStorage = <T = any>(key: string, defaultValue?: T): T | null => {
  try {
    const value = localStorage.getItem(key)
    if (value === null) return defaultValue ?? null
    return JSON.parse(value) as T
  } catch (error) {
    console.error(...)
    return defaultValue ?? null
  }
}

export const setLocalStorage = <T = any>(key: string, value: T): void => {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch (error) { console.error(...) }
}
```

- 自动 `JSON.parse` / `stringify`
- 异常安全（JSON 损坏、存储配额满等）
- 支持默认值

**当前未见调用点**——AuthContext 直接用原生 `localStorage`。这是预留工具函数。

## 后端联调思路（未来）

如果要接入 proxy-core：

1. `.env.local` 设 `VITE_API_PROXY_TARGET=http://localhost:9527`
2. `.env` 设 `VITE_API_PREFIX=/ui/api`（与 proxy-core 一致）
3. 关闭 vite-plugin-mock（`vite.config.ts:11` 的 `enable: true` 改成 `false`）
4. 后端补齐 `/ui/api/user/*`、`/ui/api/supplier/*`、`/ui/api/system/settings` 端点
5. 处理 auth：目前 axios 拦截器发 `Bearer <mock-token>`，proxy-core 期待 `config.auth.token` 或 `UI_AUTH_TOKEN` 匹配——需要真实的登录服务而非 mock

## 相关

- 认证 → [routing-and-auth.md](./routing-and-auth.md)
- 环境变量 → [env-and-build.md](./env-and-build.md)

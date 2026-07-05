# proxy-admin / 页面清单

## 本文档覆盖的源文件

- `apps/proxy-admin/src/pages/Login.tsx`
- `apps/proxy-admin/src/pages/Dashboard.tsx`
- `apps/proxy-admin/src/pages/UserManagement.tsx`
- `apps/proxy-admin/src/pages/SupplierManagement.tsx`
- `apps/proxy-admin/src/pages/LogManagement.tsx`
- `apps/proxy-admin/src/pages/SystemSettings.tsx`

## Login

`apps/proxy-admin/src/pages/Login.tsx`。整个应用最富视觉设计的页面，用了 **玻璃拟态**（glassmorphism）：

### 视觉设计

- 全屏深色背景 `#020617`
- 两个模糊光斑（左上绿、右下蓝）作装饰
- 中央玻璃卡片：`backdrop-blur-2xl` + `bg-[#0F172A]/40` + 6s 呼吸动画（`pulse-glass` keyframes）
- Logo 圆形（LockOutlined 图标）
- 深色输入框，focus 时绿色高亮边框

### 表单

```tsx
<Form form={form} onFinish={handleLogin} size="large" layout="vertical">
  <Form.Item name="username" rules={[{ required: true }]}>
    <Input prefix={<UserOutlined />} defaultValue="admin" />
  </Form.Item>
  <Form.Item name="password" rules={[{ required: true }]}>
    <Input.Password prefix={<LockOutlined />} defaultValue="123456"
      iconRender={visible => visible ? <EyeInvisibleOutlined /> : <EyeOutlined />} />
  </Form.Item>
  <Button type="primary" htmlType="submit" loading={loading}>登录</Button>
</Form>
```

- **默认值 admin / 123456**：与 mock 校验一致，方便直接点登录
- 底部提示卡片明示默认账号
- 密码可见性 toggle（`iconRender`）

### 登录处理

```ts
const handleLogin = async (values: LoginParams) => {
  setLoading(true)
  try {
    const response = await loginApi(values)
    if (response.code === 0) {
      login(response.data.token, response.data.user)
      message.success('登录成功')
      navigate('/dashboard')
    }
  } catch (error) {
    console.error('Login failed:', error)
  } finally {
    setLoading(false)
  }
}
```

- axios 拦截器处理错误 message，这里只 log
- 成功后调用 `AuthContext.login()` + `navigate('/dashboard')`

### 减动画支持

```css
@media (prefers-reduced-motion: reduce) {
  .ant-card { animation: none !important; }
}
```

尊重用户无障碍设置。

### 内联全局 `<style>`

Login 里内联 `<style>` 覆盖 antd 组件样式（`.ant-card`, `.ant-input-affix-wrapper` 等 100+ 行 CSS）。**这些样式泄漏到全站**——如果切换其他页面且未 unmount Login（无此情况，因路由切换会 unmount），会影响。当前实现有效但脆弱。

## Dashboard

`apps/proxy-admin/src/pages/Dashboard.tsx`。**静态占位**：

```tsx
<Row gutter={16} className="mb-6">
  <Col span={6}><Card><Statistic title="用户总数" value={128} prefix={<UserOutlined />} /></Card></Col>
  <Col span={6}><Card><Statistic title="供应商总数" value={8} prefix={<ShopOutlined />} /></Card></Col>
  <Col span={6}><Card><Statistic title="今日请求量" value={12580} prefix={<RiseOutlined />} /></Card></Col>
  <Col span={6}><Card><Statistic title="日志总数" value={125800} prefix={<FileTextOutlined />} /></Card></Col>
</Row>
<Card title="TODO" className="text-center py-12">
  <p className="text-gray-500">看板详细内容待后续设计补充</p>
</Card>
```

四张写死数字的卡片 + 一个 TODO 占位。无数据加载、无接口调用。

## UserManagement

`apps/proxy-admin/src/pages/UserManagement.tsx`。用户列表 + 创建 Modal。

### 表格列

- ID (80px)
- 用户名
- 昵称
- 邮箱
- 操作（编辑 / 删除按钮，**均未实现 onClick**）

### 数据加载

```ts
const loadUserList = async () => {
  setLoading(true)
  try {
    const response = await getUserList()
    if (response.code === 0) setUsers(response.data.list)
  } catch (error) { ... }
  finally { setLoading(false) }
}
useEffect(() => { loadUserList() }, [])
```

`getUserList()` → `GET /api/user/list` → mock 返回 3 个用户。

### 创建用户 Modal

四个字段：用户名 / 昵称 / 邮箱 / 头像。用 antd `Form` + `rules` 校验。邮箱额外 `type: 'email'` 校验格式。提交调 `createUser(values)` → mock 返回。

### 未实现

- 编辑/删除按钮无 handler
- 无分页控件（表格默认分页）
- 无搜索/筛选

## SupplierManagement

`apps/proxy-admin/src/pages/SupplierManagement.tsx`。供应商列表 + 添加 Modal。

### 表格列

- ID
- 供应商名称
- 类型（`<Tag color="blue">`）
- 状态（`active/inactive` → 绿/红 Tag，中文「启用/禁用」）
- 创建时间
- 操作

### 加载数据

`getSupplierList()` → `GET /api/supplier/list` → mock 返回 OpenAI / Anthropic / Google Gemini 3 家。

### 添加供应商 Modal

字段：

- 供应商名称
- 类型（Select：`llm / embedding / image / audio`）
- 状态（Switch，默认启用）
- API Key（Password 输入）
- API 地址（可选）
- 支持模型（英文逗号分隔字符串）

数据字段用 `name={['config', 'apiKey']}` 嵌套结构对应 `Supplier.config`。

### 与 proxy-core 供应商的关系

**完全独立**。proxy-core 有自己的 SQLite `providers` 表和 REST 端点 `/ui/api/providers`；proxy-admin 这里的 supplier 是**规划中的全局供应商概念**，走 `/api/supplier/*`，目前只有 mock。未来接入时需要决定：

- proxy-admin 是否直接读写 proxy-core 的 SQLite？
- 是否需要独立的数据库存管理员级配置？
- 与 proxy-cli 的 ProviderManagerModal 如何分工？

## LogManagement

`apps/proxy-admin/src/pages/LogManagement.tsx`。**只有 17 行**——完全占位：

```tsx
<Card className="text-center py-12">
  <Empty description="日志功能待后续设计补充" />
</Card>
```

未来接入 proxy-core 后应该：`GET /ui/api/requests` 列表 + `/ui/api/logs/stream` WebSocket 日志流。

## SystemSettings

`apps/proxy-admin/src/pages/SystemSettings.tsx`。系统级配置表单：

### 字段

- 站点名称（required）
- 站点描述（Text Area 3 行）
- 最大上传大小 MB（InputNumber 1..1024, required）
- 开放注册（Switch）

### 加载 & 保存

```ts
const loadSettings = async () => {
  const response = await getSystemSettings()
  if (response.code === 0) form.setFieldsValue(response.data)
}
const handleSave = async (values) => {
  const response = await saveSystemSettings(values)
  if (response.code === 0) message.success('保存成功')
}
```

`getSystemSettings` / `saveSystemSettings` 都走 mock（`/api/system/settings`）。

**注意字段与 proxy-core config 不重叠**：这些字段（siteName / siteDescription 等）是 proxy-admin 独立的管理域，不影响 proxy-core 的运行配置。未来若统一，需要设计映射关系。

## 状态对比

| 页面 | 功能完成度 | 数据源 | 备注 |
|---|---|---|---|
| Login | ✅ 完整（含视觉） | mock | admin/123456 |
| Dashboard | ❌ 静态占位 | 无 | 4 张写死卡 + TODO |
| UserManagement | ⚠️ 部分（列表+创建） | mock | 编辑/删除按钮无 handler |
| SupplierManagement | ⚠️ 部分（列表+添加） | mock | 编辑/删除按钮无 handler |
| LogManagement | ❌ 完全占位 | 无 | 仅 `<Empty>` |
| SystemSettings | ✅ 完整（表单） | mock | 但字段和 proxy-core 无关 |

## 相关

- 服务层与 mock → [services-and-mock.md](./services-and-mock.md)
- 布局 → [layout-and-menu.md](./layout-and-menu.md)

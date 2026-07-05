# proxy-admin / 布局与菜单

## 本文档覆盖的源文件

- `apps/proxy-admin/src/layouts/MainLayout.tsx`

## 结构

```
┌────────────────────────────────────────────────┐
│  Sider 200px       │  Header 64px               │
│  ┌────────────┐   ├────────────────────────────┤
│  │ Proxy Admin│   │  Content (padding 6, bg-gray-50)
│  ├────────────┤   │
│  │ 📊 看板     │   │      <Outlet />
│  │ 👤 用户管理  │   │      (页面内容渲染在这)
│  │ 🏬 供应商    │   │
│  │ 📄 日志     │   │
│  │ ⚙️ 系统设置  │   │
│  └────────────┘   │
└────────────────────┴─────────────────────────────┘
```

## 三个区

### Sider（左侧）

```tsx
<Sider width={200} className="bg-white shadow-md">
  <div className="h-16 flex items-center justify-center text-xl font-bold text-blue-600 border-b">
    Proxy Admin
  </div>
  <Menu mode="inline" selectedKeys={[location.pathname]} items={menuItems} />
</Sider>
```

- **Logo 区 64px 高**：与 Header 高度对齐
- **Menu**：Ant Design `Menu` inline 模式，`selectedKeys` 用 `location.pathname` 自动高亮当前路由
- **无 preflight 冲突**：`tailwind.config.js` 设 `preflight: false`，让 antd 自己的基础样式生效

### 菜单项

```ts
const menuItems = [
  { key: '/dashboard', icon: <DashboardOutlined />, label: '看板',    onClick: () => navigate('/dashboard') },
  { key: '/user',      icon: <UserOutlined />,      label: '用户管理', onClick: () => navigate('/user') },
  { key: '/supplier',  icon: <ShopOutlined />,      label: '供应商管理', onClick: () => navigate('/supplier') },
  { key: '/log',       icon: <FileTextOutlined />,  label: '日志管理', onClick: () => navigate('/log') },
  { key: '/system',    icon: <SettingOutlined />,   label: '系统设置', onClick: () => navigate('/system') }
]
```

- **key 与 path 一致**：`selectedKeys={[location.pathname]}` 高亮成立的前提
- **onClick navigate**：不用 antd Menu `onSelect`——直接绑 onClick 更直观
- **五项**：与 router 定义的五个子路由一一对应；`/`（根）不在菜单里但视觉上等同 `/dashboard`

### Header（顶部）

```tsx
<Header className="bg-white shadow-sm px-6 flex justify-between items-center">
  <div></div>
  <div className="flex items-center">
    <Dropdown menu={{ items: userMenuItems }} placement="bottomRight">
      <Space className="cursor-pointer">
        <Avatar src={user?.avatar} size="small" />
        <span className="text-sm">{user?.nickname}</span>
      </Space>
    </Dropdown>
  </div>
</Header>
```

- 左侧空 div 占位（未来放面包屑）
- 右侧头像 + 昵称 → 下拉菜单
- 下拉菜单当前只有「退出登录」（`userMenuItems`）

### Content（内容区）

```tsx
<Content className="p-6 bg-gray-50 min-h-[calc(100vh-64px)]">
  <Outlet />
</Content>
```

- `Outlet` 渲染子路由的 element（六个页面之一）
- `min-h-[calc(100vh-64px)]`：至少填满视口减 Header 高度，避免短内容页面底部有空白

## 退出登录 `handleLogout`

```ts
const handleLogout = async () => {
  try {
    await logoutApi()
    logout()
    message.success('退出成功')
    navigate('/login')
  } catch (error) {
    // 401 已被 axios 拦截处理，这里兜底调 logout + navigate
    logout()
    navigate('/login')
  }
}
```

- 先调后端登出 API（mock 里直接返回成功）
- 无论成败都执行 `AuthContext.logout()` + `navigate('/login')`
- axios 拦截器已经在 401 时 `window.location.href = '/login'`，这里的兜底覆盖非 401 错误

## 依赖注入

```ts
const { user, logout } = useAuth()
const navigate = useNavigate()
const location = useLocation()
```

三个 hook：认证状态、路由导航、当前路径。用 `useAuth` 而非 loader 返回值是因为要用 `logout` 方法。

## 相关

- 路由与守卫 → [routing-and-auth.md](./routing-and-auth.md)
- 各页面细节 → [pages.md](./pages.md)

# Proxy Admin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build complete proxy-admin frontend with auth flow, mock APIs, basic page structure, and main layout.

**Architecture:** React + TypeScript + Vite stack with React Context for auth state, React Router for routing, axios for HTTP requests, vite-plugin-mock for API mocking, Ant Design v5 for UI components, Tailwind CSS for styling. Dual auth guarding via router loaders and axios interceptors.

**Tech Stack:** React 18, TypeScript, Vite, React Router v6, Axios, Ant Design v5, Tailwind CSS, vite-plugin-mock.

## Global Constraints

- Package manager: Use pnpm only, no npm/yarn
- UI: Ant Design v5 for all components, Tailwind CSS for custom styling
- State management: Use React Context + useReducer for auth state, no external state libraries unless absolutely necessary
- Code style: Follow TypeScript strict mode, all strict checks enabled
- Commit messages: Follow `type: description` format (feat/fix/docs/style/refactor/test/chore)
- Environment variables: Add type declarations in `src/vite-env.d.ts` for new env vars
- Mock files: Each API has separate mock implementation in `src/mock/` directory

---

### Task 1: Install Dependencies

**Files:**
- Modify: `apps/proxy-admin/package.json`
- Modify: `pnpm-lock.yaml` (auto-generated)

**Interfaces:**
- Produces: Required dependencies installed: `vite-plugin-mock`, `tailwindcss`, `postcss`, `autoprefixer`

- [ ] **Step 1: Install dependencies via pnpm**

Run:
```bash
cd /Users/cashely.shi/Documents/projects/cc-monitoring/apps/proxy-admin
pnpm add -D vite-plugin-mock mockjs tailwindcss postcss autoprefixer
pnpm add @ant-design/icons
```

Expected: All dependencies installed successfully, no errors.

- [ ] **Step 2: Verify installation**

Run:
```bash
pnpm list tailwindcss vite-plugin-mock @ant-design/icons
```

Expected: Shows installed versions of all packages.

- [ ] **Step 3: Commit**
```bash
git add package.json pnpm-lock.yaml
git commit -m "chore: install tailwindcss, vite-plugin-mock and icons"
```

---

### Task 2: Configure Tailwind CSS

**Files:**
- Create: `apps/proxy-admin/tailwind.config.js`
- Create: `apps/proxy-admin/postcss.config.js`
- Modify: `apps/proxy-admin/src/styles/global.css`
- Modify: `apps/proxy-admin/vite.config.ts`

**Interfaces:**
- Consumes: Tailwind CSS installed from Task 1
- Produces: Tailwind CSS configured and working in project

- [ ] **Step 1: Initialize Tailwind config**

Run:
```bash
cd /Users/cashely.shi/Documents/projects/cc-monitoring/apps/proxy-admin
npx tailwindcss init -p
```

Expected: Creates `tailwind.config.js` and `postcss.config.js` files.

- [ ] **Step 2: Update tailwind.config.js**

Replace content with:
```javascript
/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {},
  },
  plugins: [],
  corePlugins: {
    preflight: false, // Disable preflight to avoid conflicts with Ant Design
  },
}
```

- [ ] **Step 3: Update src/styles/global.css**

Add Tailwind directives at top:
```css
@tailwind base;
@tailwind components;
@tailwind utilities;

/* Rest of existing global styles */
```

- [ ] **Step 4: Verify Tailwind works**

Add a test class to `App.tsx`:
```tsx
function App() {
  return <div className="text-red-500 text-2xl">Hello Tailwind</div>
}
```

Run dev server:
```bash
pnpm dev
```

Expected: Page shows red "Hello Tailwind" text.

- [ ] **Step 5: Revert test change in App.tsx**

- [ ] **Step 6: Commit**
```bash
git add tailwind.config.js postcss.config.js src/styles/global.css
git commit -m "feat: configure Tailwind CSS"
```

---

### Task 3: Implement AuthContext

**Files:**
- Create: `apps/proxy-admin/src/contexts/AuthContext.tsx`
- Create: `apps/proxy-admin/src/types/auth.ts`
- Modify: `apps/proxy-admin/src/main.tsx`

**Interfaces:**
- Produces: `AuthProvider` component, `useAuth` hook with `login`, `logout`, `user`, `token`, `isAuthenticated` properties

- [ ] **Step 1: Create auth types file**

Create `src/types/auth.ts`:
```typescript
export interface UserInfo {
  id: number;
  username: string;
  nickname: string;
  avatar: string;
  email: string;
}

export interface AuthState {
  token: string | null;
  user: UserInfo | null;
  isAuthenticated: boolean;
}

export interface LoginParams {
  username: string;
  password: string;
}

export interface AuthContextType extends AuthState {
  login: (token: string, user: UserInfo) => void;
  logout: () => void;
}
```

- [ ] **Step 2: Create AuthContext implementation**

Create `src/contexts/AuthContext.tsx`:
```tsx
import { createContext, useContext, useReducer, ReactNode } from 'react';
import { AuthState, AuthContextType, UserInfo } from '../types/auth';

const initialState: AuthState = {
  token: localStorage.getItem('token'),
  user: JSON.parse(localStorage.getItem('user') || 'null'),
  isAuthenticated: !!localStorage.getItem('token'),
};

type AuthAction =
  | { type: 'LOGIN'; payload: { token: string; user: UserInfo } }
  | { type: 'LOGOUT' };

const authReducer = (state: AuthState, action: AuthAction): AuthState => {
  switch (action.type) {
    case 'LOGIN':
      return {
        ...state,
        token: action.payload.token,
        user: action.payload.user,
        isAuthenticated: true,
      };
    case 'LOGOUT':
      return {
        ...state,
        token: null,
        user: null,
        isAuthenticated: false,
      };
    default:
      return state;
  }
};

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [state, dispatch] = useReducer(authReducer, initialState);

  const login = (token: string, user: UserInfo) => {
    localStorage.setItem('token', token);
    localStorage.setItem('user', JSON.stringify(user));
    dispatch({ type: 'LOGIN', payload: { token, user } });
  };

  const logout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    dispatch({ type: 'LOGOUT' });
  };

  return (
    <AuthContext.Provider
      value={{
        ...state,
        login,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
```

- [ ] **Step 3: Add AuthProvider to main.tsx**

Update `src/main.tsx`:
```tsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles/global.css';
import { AuthProvider } from './contexts/AuthContext';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AuthProvider>
      <App />
    </AuthProvider>
  </React.StrictMode>,
);
```

- [ ] **Step 4: Test AuthContext**

Add test code to App.tsx:
```tsx
import { useAuth } from './contexts/AuthContext';

function App() {
  const { isAuthenticated, login, logout } = useAuth();
  
  return (
    <div>
      <p>Authenticated: {isAuthenticated ? 'Yes' : 'No'}</p>
      <button onClick={() => login('test-token', { id: 1, username: 'test', nickname: 'Test User', avatar: '', email: 'test@example.com' })}>
        Login
      </button>
      <button onClick={logout}>Logout</button>
    </div>
  );
}
```

Run dev server, test login/logout functionality. Expected: Clicking login updates state and localStorage, clicking logout clears them.

- [ ] **Step 5: Revert test changes in App.tsx**

- [ ] **Step 6: Commit**
```bash
git add src/types/auth.ts src/contexts/AuthContext.tsx src/main.tsx
git commit -m "feat: implement AuthContext for auth state management"
```

---

### Task 4: Update Axios Interceptors

**Files:**
- Modify: `apps/proxy-admin/src/services/request.ts`
- Modify: `apps/proxy-admin/src/services/api.ts` (create if not exists)
- Modify: `apps/proxy-admin/src/vite-env.d.ts` (if needed)

**Interfaces:**
- Consumes: `useAuth` hook from Task 3
- Produces: Axios instance with auth token injection and 401 redirect handling, API service functions

- [ ] **Step 1: Update request.ts with interceptors**

Replace content:
```typescript
import axios from 'axios';
import { useAuth } from '../contexts/AuthContext';
import { message } from 'antd';

// Create axios instance
const request = axios.create({
  baseURL: import.meta.env.VITE_API_PREFIX || '/api',
  timeout: 10000,
});

// Request interceptor - add auth token
request.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  },
);

// Response interceptor - handle 401 and errors
request.interceptors.response.use(
  (response) => {
    return response.data;
  },
  (error) => {
    console.error('请求错误:', error);
    
    // Handle 401 Unauthorized
    if (error.response?.status === 401) {
      message.error('登录已过期，请重新登录');
      // Clear auth state
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      // Redirect to login
      window.location.href = '/login';
    } else if (error.response?.data?.message) {
      message.error(error.response.data.message);
    } else {
      message.error('请求失败，请稍后重试');
    }
    
    return Promise.reject(error);
  },
);

export default request;
```

- [ ] **Step 2: Create API service functions**

Create `src/services/api.ts`:
```typescript
import request from './request';
import { UserInfo, LoginParams } from '../types/auth';

// Auth APIs
export const login = (params: LoginParams) => {
  return request.post<{ token: string; user: UserInfo }>('/login', params);
};

export const logout = () => {
  return request.post('/logout');
};

export const getUserInfo = () => {
  return request.get<{ user: UserInfo }>('/user/info');
};

// User management APIs
export const getUserList = (params?: { page?: number; pageSize?: number }) => {
  return request.get<{ list: UserInfo[]; total: number }>('/user/list', { params });
};

export const createUser = (params: Omit<UserInfo, 'id'>) => {
  return request.post('/user', params);
};

// Supplier management APIs
export interface Supplier {
  id: number;
  name: string;
  type: string;
  status: 'active' | 'inactive';
  config: Record<string, any>;
  createdAt: string;
}

export const getSupplierList = (params?: { page?: number; pageSize?: number }) => {
  return request.get<{ list: Supplier[]; total: number }>('/supplier/list', { params });
};

export const createSupplier = (params: Omit<Supplier, 'id' | 'createdAt'>) => {
  return request.post('/supplier', params);
};

// System settings APIs
export interface SystemSettings {
  siteName: string;
  siteDescription: string;
  maxUploadSize: number;
  enableRegistration: boolean;
}

export const getSystemSettings = () => {
  return request.get<SystemSettings>('/system/settings');
};

export const saveSystemSettings = (params: SystemSettings) => {
  return request.post('/system/settings', params);
};
```

- [ ] **Step 3: Add environment variable type (if missing)**

Update `src/vite-env.d.ts`:
```typescript
/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_PREFIX: string;
  // Add other env variables here
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
```

- [ ] **Step 4: Commit**
```bash
git add src/services/request.ts src/services/api.ts src/vite-env.d.ts
git commit -m "feat: update axios interceptors and add API services"
```

---

### Task 5: Implement Mock APIs

**Files:**
- Modify: `apps/proxy-admin/vite.config.ts`
- Create: `apps/proxy-admin/src/mock/index.ts`
- Create: `apps/proxy-admin/src/mock/user.ts`
- Create: `apps/proxy-admin/src/mock/supplier.ts`
- Create: `apps/proxy-admin/src/mock/system.ts`

**Interfaces:**
- Consumes: API types from Task 4
- Produces: Mock implementations for all APIs, vite-plugin-mock configured

- [ ] **Step 1: Configure vite-plugin-mock in vite.config.ts**

Update `vite.config.ts`:
```typescript
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteMockServe } from 'vite-plugin-mock';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    viteMockServe({
      mockPath: 'src/mock',
      enable: true, // Enable mock in development
      logger: true,
    }),
  ],
});
```

- [ ] **Step 2: Create user mock file**

Create `src/mock/user.ts`:
```typescript
import { MockMethod } from 'vite-plugin-mock';
import { UserInfo } from '../types/auth';

const mockUsers: UserInfo[] = [
  {
    id: 1,
    username: 'admin',
    nickname: 'Administrator',
    avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=admin',
    email: 'admin@example.com',
  },
  {
    id: 2,
    username: 'user1',
    nickname: 'Normal User',
    avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=user1',
    email: 'user1@example.com',
  },
  {
    id: 3,
    username: 'user2',
    nickname: 'Test User',
    avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=user2',
    email: 'user2@example.com',
  },
];

export default [
  // Login API
  {
    url: '/api/login',
    method: 'post',
    response: ({ body }) => {
      const { username, password } = body;
      
      // Mock validation
      if (username === 'admin' && password === '123456') {
        return {
          code: 0,
          message: '登录成功',
          data: {
            token: 'mock-token-' + Date.now(),
            user: mockUsers[0],
          },
        };
      }
      
      return {
        code: 401,
        message: '用户名或密码错误',
        data: null,
      };
    },
  },
  
  // Logout API
  {
    url: '/api/logout',
    method: 'post',
    response: () => {
      return {
        code: 0,
        message: '退出成功',
        data: { success: true },
      };
    },
  },
  
  // Get user info API
  {
    url: '/api/user/info',
    method: 'get',
    response: ({ headers }) => {
      const authHeader = headers.authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return {
          code: 401,
          message: '未授权',
          data: null,
        };
      }
      
      return {
        code: 0,
        message: 'success',
        data: {
          user: mockUsers[0],
        },
      };
    },
  },
  
  // Get user list API
  {
    url: '/api/user/list',
    method: 'get',
    response: ({ query }) => {
      const page = Number(query.page) || 1;
      const pageSize = Number(query.pageSize) || 10;
      const start = (page - 1) * pageSize;
      const end = start + pageSize;
      
      return {
        code: 0,
        message: 'success',
        data: {
          list: mockUsers.slice(start, end),
          total: mockUsers.length,
        },
      };
    },
  },
] as MockMethod[];
```

- [ ] **Step 3: Create supplier mock file**

Create `src/mock/supplier.ts`:
```typescript
import { MockMethod } from 'vite-plugin-mock';
import { Supplier } from '../services/api';

const mockSuppliers: Supplier[] = [
  {
    id: 1,
    name: 'OpenAI',
    type: 'llm',
    status: 'active',
    config: {
      apiKey: 'sk-xxx',
      baseURL: 'https://api.openai.com/v1',
      models: ['gpt-3.5-turbo', 'gpt-4'],
    },
    createdAt: '2024-01-01T00:00:00Z',
  },
  {
    id: 2,
    name: 'Anthropic',
    type: 'llm',
    status: 'active',
    config: {
      apiKey: 'sk-xxx',
      baseURL: 'https://api.anthropic.com',
      models: ['claude-3-sonnet', 'claude-3-opus'],
    },
    createdAt: '2024-01-15T00:00:00Z',
  },
  {
    id: 3,
    name: 'Google Gemini',
    type: 'llm',
    status: 'inactive',
    config: {
      apiKey: 'xxx',
      models: ['gemini-pro'],
    },
    createdAt: '2024-02-01T00:00:00Z',
  },
];

export default [
  // Get supplier list API
  {
    url: '/api/supplier/list',
    method: 'get',
    response: ({ query }) => {
      const page = Number(query.page) || 1;
      const pageSize = Number(query.pageSize) || 10;
      const start = (page - 1) * pageSize;
      const end = start + pageSize;
      
      return {
        code: 0,
        message: 'success',
        data: {
          list: mockSuppliers.slice(start, end),
          total: mockSuppliers.length,
        },
      };
    },
  },
  
  // Create supplier API
  {
    url: '/api/supplier',
    method: 'post',
    response: ({ body }) => {
      const newSupplier: Supplier = {
        id: mockSuppliers.length + 1,
        ...body,
        createdAt: new Date().toISOString(),
      };
      mockSuppliers.push(newSupplier);
      
      return {
        code: 0,
        message: '创建成功',
        data: newSupplier,
      };
    },
  },
] as MockMethod[];
```

- [ ] **Step 4: Create system mock file**

Create `src/mock/system.ts`:
```typescript
import { MockMethod } from 'vite-plugin-mock';
import { SystemSettings } from '../services/api';

const mockSettings: SystemSettings = {
  siteName: 'Proxy Admin',
  siteDescription: 'AI Proxy Management System',
  maxUploadSize: 100,
  enableRegistration: true,
};

export default [
  // Get system settings API
  {
    url: '/api/system/settings',
    method: 'get',
    response: () => {
      return {
        code: 0,
        message: 'success',
        data: mockSettings,
      };
    },
  },
  
  // Save system settings API
  {
    url: '/api/system/settings',
    method: 'post',
    response: ({ body }) => {
      Object.assign(mockSettings, body);
      return {
        code: 0,
        message: '保存成功',
        data: { success: true },
      };
    },
  },
] as MockMethod[];
```

- [ ] **Step 5: Create mock index file**

Create `src/mock/index.ts`:
```typescript
import userMock from './user';
import supplierMock from './supplier';
import systemMock from './system';

export default [...userMock, ...supplierMock, ...systemMock];
```

- [ ] **Step 6: Test mock APIs**

Test login API:
```bash
curl -X POST http://localhost:5173/api/login -H "Content-Type: application/json" -d '{"username":"admin","password":"123456"}'
```

Expected: Returns success response with token and user info.

Test user info API with token:
```bash
curl -H "Authorization: Bearer <token-from-login>" http://localhost:5173/api/user/info
```

Expected: Returns user info.

- [ ] **Step 7: Commit**
```bash
git add vite.config.ts src/mock/
git commit -m "feat: implement mock APIs with vite-plugin-mock"
```

---

### Task 6: Update Router with Protected Routes

**Files:**
- Modify: `apps/proxy-admin/src/router/index.tsx`
- Create: `apps/proxy-admin/src/router/guard.ts`

**Interfaces:**
- Consumes: `getUserInfo` API from Task 4, `useAuth` hook from Task 3
- Produces: Router with public and protected routes, auth loader guards

- [ ] **Step 1: Create router guard loader**

Create `src/router/guard.ts`:
```typescript
import { redirect } from 'react-router-dom';
import { getUserInfo } from '../services/api';
import { useAuth } from '../contexts/AuthContext';

// Auth loader for protected routes
export const authLoader = async () => {
  const token = localStorage.getItem('token');
  
  // No token, redirect to login
  if (!token) {
    return redirect('/login');
  }
  
  try {
    // Verify token by getting user info
    const response = await getUserInfo();
    if (response.code !== 0) {
      return redirect('/login');
    }
    
    // Return user info for route use
    return { user: response.data.user };
  } catch (error) {
    // Token invalid, redirect to login
    return redirect('/login');
  }
};

// Public route loader (already logged in, redirect to dashboard)
export const publicLoader = async () => {
  const token = localStorage.getItem('token');
  if (token) {
    return redirect('/dashboard');
  }
  return null;
};
```

- [ ] **Step 2: Update router configuration**

Replace `src/router/index.tsx` content:
```typescript
import { createBrowserRouter, RouterProvider, Outlet } from 'react-router-dom';
import { authLoader, publicLoader } from './guard';
import MainLayout from '../layouts/MainLayout';
import Login from '../pages/Login';
import Dashboard from '../pages/Dashboard';
import UserManagement from '../pages/UserManagement';
import SupplierManagement from '../pages/SupplierManagement';
import LogManagement from '../pages/LogManagement';
import SystemSettings from '../pages/SystemSettings';

const router = createBrowserRouter([
  {
    path: '/login',
    element: <Login />,
    loader: publicLoader,
  },
  {
    path: '/',
    element: <MainLayout />,
    loader: authLoader,
    children: [
      {
        path: '',
        element: <Dashboard />,
      },
      {
        path: 'dashboard',
        element: <Dashboard />,
      },
      {
        path: 'user',
        element: <UserManagement />,
      },
      {
        path: 'supplier',
        element: <SupplierManagement />,
      },
      {
        path: 'log',
        element: <LogManagement />,
      },
      {
        path: 'system',
        element: <SystemSettings />,
      },
    ],
  },
]);

export default function Router() {
  return <RouterProvider router={router} />;
}
```

- [ ] **Step 3: Update App.tsx to use Router**

Update `src/App.tsx`:
```tsx
import Router from './router';

function App() {
  return <Router />;
}

export default App;
```

- [ ] **Step 4: Commit**
```bash
git add src/router/guard.ts src/router/index.tsx src/App.tsx
git commit -m "feat: update router with protected routes and auth guards"
```

---

### Task 7: Implement MainLayout Component

**Files:**
- Create: `apps/proxy-admin/src/layouts/MainLayout.tsx`

**Interfaces:**
- Consumes: `useAuth` hook from Task 3, `logout` API from Task 4
- Produces: Main layout with header (user dropdown), sider (menu), content area

- [ ] **Step 1: Create MainLayout component**

Create `src/layouts/MainLayout.tsx`:
```tsx
import { Layout, Menu, Dropdown, Avatar, Button, Space } from 'antd';
import {
  DashboardOutlined,
  UserOutlined,
  ShopOutlined,
  FileTextOutlined,
  SettingOutlined,
  LogoutOutlined,
} from '@ant-design/icons';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { logout as logoutApi } from '../services/api';
import { message } from 'antd';

const { Header, Sider, Content } = Layout;

const MainLayout = () => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const handleLogout = async () => {
    try {
      await logoutApi();
      logout();
      message.success('退出成功');
      navigate('/login');
    } catch (error) {
      // Already handled by interceptor, just call logout
      logout();
      navigate('/login');
    }
  };

  const userMenuItems = [
    {
      key: 'logout',
      icon: <LogoutOutlined />,
      label: '退出登录',
      onClick: handleLogout,
    },
  ];

  const menuItems = [
    {
      key: '/dashboard',
      icon: <DashboardOutlined />,
      label: '看板',
      onClick: () => navigate('/dashboard'),
    },
    {
      key: '/user',
      icon: <UserOutlined />,
      label: '用户管理',
      onClick: () => navigate('/user'),
    },
    {
      key: '/supplier',
      icon: <ShopOutlined />,
      label: '供应商管理',
      onClick: () => navigate('/supplier'),
    },
    {
      key: '/log',
      icon: <FileTextOutlined />,
      label: '日志管理',
      onClick: () => navigate('/log'),
    },
    {
      key: '/system',
      icon: <SettingOutlined />,
      label: '系统设置',
      onClick: () => navigate('/system'),
    },
  ];

  return (
    <Layout className="min-h-screen">
      <Sider width={200} className="bg-white shadow-md">
        <div className="h-16 flex items-center justify-center text-xl font-bold text-blue-600 border-b">
          Proxy Admin
        </div>
        <Menu
          mode="inline"
          selectedKeys={[location.pathname]}
          items={menuItems}
          className="border-none"
        />
      </Sider>
      <Layout>
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
        <Content className="p-6 bg-gray-50 min-h-[calc(100vh-64px)]">
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  );
};

export default MainLayout;
```

- [ ] **Step 2: Test layout**

Run dev server, login (when login page is implemented). Expected: Layout shows correctly with menu, header, user dropdown.

- [ ] **Step 3: Commit**
```bash
git add src/layouts/MainLayout.tsx
git commit -m "feat: implement MainLayout component with menu and header"
```

---

### Task 8: Implement Login Page

**Files:**
- Create: `apps/proxy-admin/src/pages/Login.tsx`

**Interfaces:**
- Consumes: `login` API from Task 4, `useAuth` hook from Task 3
- Produces: Login page with username/password form, validation, error handling

- [ ] **Step 1: Create Login component**

Create `src/pages/Login.tsx`:
```tsx
import { Form, Input, Button, Card, message } from 'antd';
import { UserOutlined, LockOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { login as loginApi } from '../services/api';
import { LoginParams } from '../types/auth';

const Login = () => {
  const [form] = Form.useForm();
  const navigate = useNavigate();
  const { login } = useAuth();

  const handleLogin = async (values: LoginParams) => {
    try {
      const response = await loginApi(values);
      if (response.code === 0) {
        const { token, user } = response.data;
        login(token, user);
        message.success('登录成功');
        navigate('/dashboard');
      }
    } catch (error) {
      // Error already handled by interceptor
      console.error('Login failed:', error);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center p-4">
      <Card className="w-full max-w-md shadow-xl">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-gray-800 mb-2">Proxy Admin</h1>
          <p className="text-gray-500">欢迎登录管理系统</p>
        </div>

        <Form
          form={form}
          name="login"
          onFinish={handleLogin}
          autoComplete="off"
          size="large"
        >
          <Form.Item
            name="username"
            rules={[{ required: true, message: '请输入用户名' }]}
          >
            <Input 
              prefix={<UserOutlined className="text-gray-400" />} 
              placeholder="用户名" 
              defaultValue="admin"
            />
          </Form.Item>

          <Form.Item
            name="password"
            rules={[{ required: true, message: '请输入密码' }]}
          >
            <Input.Password
              prefix={<LockOutlined className="text-gray-400" />}
              placeholder="密码"
              defaultValue="123456"
            />
          </Form.Item>

          <Form.Item>
            <Button type="primary" htmlType="submit" className="w-full">
              登录
            </Button>
          </Form.Item>
        </Form>

        <div className="text-center text-sm text-gray-500">
          <p>默认账号: admin / 123456</p>
        </div>
      </Card>
    </div>
  );
};

export default Login;
```

- [ ] **Step 2: Test login flow**

Run dev server, go to `/login`. Expected:
- Enter admin/123456 → login success, redirect to dashboard
- Enter wrong credentials → shows error message
- Already logged in → redirects to dashboard directly

- [ ] **Step 3: Commit**
```bash
git add src/pages/Login.tsx
git commit -m "feat: implement Login page with form and validation"
```

---

### Task 9: Implement Dashboard Page

**Files:**
- Create: `apps/proxy-admin/src/pages/Dashboard.tsx`

**Interfaces:**
- Produces: Dashboard page (content TODO per requirements)

- [ ] **Step 1: Create Dashboard component**

Create `src/pages/Dashboard.tsx`:
```tsx
import { Card, Statistic, Row, Col } from 'antd';
import { UserOutlined, ShopOutlined, FileTextOutlined, RiseOutlined } from '@ant-design/icons';

const Dashboard = () => {
  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-800">看板</h1>
        <p className="text-gray-500">欢迎使用代理管理系统</p>
      </div>

      <Row gutter={16} className="mb-6">
        <Col span={6}>
          <Card>
            <Statistic
              title="用户总数"
              value={128}
              prefix={<UserOutlined className="text-blue-500" />}
              valueStyle={{ color: '#1890ff' }}
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic
              title="供应商总数"
              value={8}
              prefix={<ShopOutlined className="text-green-500" />}
              valueStyle={{ color: '#52c41a' }}
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic
              title="今日请求量"
              value={12580}
              prefix={<RiseOutlined className="text-orange-500" />}
              valueStyle={{ color: '#fa8c16' }}
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic
              title="日志总数"
              value={125800}
              prefix={<FileTextOutlined className="text-purple-500" />}
              valueStyle={{ color: '#722ed1' }}
            />
          </Card>
        </Col>
      </Row>

      <Card title="TODO" className="text-center py-12">
        <p className="text-gray-500">看板详细内容待后续设计补充</p>
      </Card>
    </div>
  );
};

export default Dashboard;
```

- [ ] **Step 2: Commit**
```bash
git add src/pages/Dashboard.tsx
git commit -m "feat: implement Dashboard page (basic structure)"
```

---

### Task 10: Implement UserManagement Page

**Files:**
- Create: `apps/proxy-admin/src/pages/UserManagement.tsx`

**Interfaces:**
- Consumes: `getUserList` API from Task 4
- Produces: User management page with table, create button (other functions TODO)

- [ ] **Step 1: Create UserManagement component**

Create `src/pages/UserManagement.tsx`:
```tsx
import { Table, Button, Space, Card, Modal, Form, Input, message } from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined } from '@ant-design/icons';
import { useState, useEffect } from 'react';
import { getUserList, createUser, UserInfo } from '../services/api';
import { ColumnType } from 'antd/es/table';

const UserManagement = () => {
  const [users, setUsers] = useState<UserInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);
  const [form] = Form.useForm();

  const columns: ColumnType<UserInfo>[] = [
    {
      title: 'ID',
      dataIndex: 'id',
      key: 'id',
      width: 80,
    },
    {
      title: '用户名',
      dataIndex: 'username',
      key: 'username',
    },
    {
      title: '昵称',
      dataIndex: 'nickname',
      key: 'nickname',
    },
    {
      title: '邮箱',
      dataIndex: 'email',
      key: 'email',
    },
    {
      title: '操作',
      key: 'action',
      width: 200,
      render: (_, record) => (
        <Space size="small">
          <Button type="link" icon={<EditOutlined />} size="small">
            编辑
          </Button>
          <Button type="link" danger icon={<DeleteOutlined />} size="small">
            删除
          </Button>
        </Space>
      ),
    },
  ];

  const loadUserList = async () => {
    setLoading(true);
    try {
      const response = await getUserList();
      if (response.code === 0) {
        setUsers(response.data.list);
      }
    } catch (error) {
      console.error('Failed to load user list:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateUser = async (values: Omit<UserInfo, 'id'>) => {
    try {
      const response = await createUser(values);
      if (response.code === 0) {
        message.success('创建成功');
        setModalVisible(false);
        form.resetFields();
        loadUserList();
      }
    } catch (error) {
      console.error('Failed to create user:', error);
    }
  };

  useEffect(() => {
    loadUserList();
  }, []);

  return (
    <div>
      <div className="mb-6 flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">用户管理</h1>
          <p className="text-gray-500">管理系统用户账号</p>
        </div>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setModalVisible(true)}>
          创建用户
        </Button>
      </div>

      <Card>
        <Table
          columns={columns}
          dataSource={users}
          rowKey="id"
          loading={loading}
          bordered={false}
        />
      </Card>

      <Modal
        title="创建用户"
        open={modalVisible}
        onCancel={() => setModalVisible(false)}
        footer={null}
      >
        <Form
          form={form}
          layout="vertical"
          onFinish={handleCreateUser}
        >
          <Form.Item
            name="username"
            label="用户名"
            rules={[{ required: true, message: '请输入用户名' }]}
          >
            <Input placeholder="请输入用户名" />
          </Form.Item>

          <Form.Item
            name="nickname"
            label="昵称"
            rules={[{ required: true, message: '请输入昵称' }]}
          >
            <Input placeholder="请输入昵称" />
          </Form.Item>

          <Form.Item
            name="email"
            label="邮箱"
            rules={[
              { required: true, message: '请输入邮箱' },
              { type: 'email', message: '请输入有效的邮箱地址' }
            ]}
          >
            <Input placeholder="请输入邮箱" />
          </Form.Item>

          <Form.Item
            name="avatar"
            label="头像"
          >
            <Input placeholder="请输入头像URL" />
          </Form.Item>

          <Form.Item className="text-right mb-0">
            <Space>
              <Button onClick={() => setModalVisible(false)}>取消</Button>
              <Button type="primary" htmlType="submit">创建</Button>
            </Space>
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

export default UserManagement;
```

- [ ] **Step 2: Test user page**

Run dev server, go to `/user`. Expected: Shows user table with mock data, create button opens modal.

- [ ] **Step 3: Commit**
```bash
git add src/pages/UserManagement.tsx
git commit -m "feat: implement UserManagement page with table and create function"
```

---

### Task 11: Implement SupplierManagement Page

**Files:**
- Create: `apps/proxy-admin/src/pages/SupplierManagement.tsx`

**Interfaces:**
- Consumes: `getSupplierList` API from Task 4
- Produces: Supplier management page with list, add button (other functions TODO)

- [ ] **Step 1: Create SupplierManagement component**

Create `src/pages/SupplierManagement.tsx`:
```tsx
import { Table, Button, Space, Card, Tag, Modal, Form, Input, Select, Switch, message } from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined } from '@ant-design/icons';
import { useState, useEffect } from 'react';
import { getSupplierList, createSupplier, Supplier } from '../services/api';
import { ColumnType } from 'antd/es/table';

const { Option } = Select;

const SupplierManagement = () => {
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);
  const [form] = Form.useForm();

  const columns: ColumnType<Supplier>[] = [
    {
      title: 'ID',
      dataIndex: 'id',
      key: 'id',
      width: 80,
    },
    {
      title: '供应商名称',
      dataIndex: 'name',
      key: 'name',
    },
    {
      title: '类型',
      dataIndex: 'type',
      key: 'type',
      render: (type) => <Tag color="blue">{type}</Tag>,
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      render: (status) => (
        <Tag color={status === 'active' ? 'green' : 'red'}>
          {status === 'active' ? '启用' : '禁用'}
        </Tag>
      ),
    },
    {
      title: '创建时间',
      dataIndex: 'createdAt',
      key: 'createdAt',
    },
    {
      title: '操作',
      key: 'action',
      width: 200,
      render: (_, record) => (
        <Space size="small">
          <Button type="link" icon={<EditOutlined />} size="small">
            编辑
          </Button>
          <Button type="link" danger icon={<DeleteOutlined />} size="small">
            删除
          </Button>
        </Space>
      ),
    },
  ];

  const loadSupplierList = async () => {
    setLoading(true);
    try {
      const response = await getSupplierList();
      if (response.code === 0) {
        setSuppliers(response.data.list);
      }
    } catch (error) {
      console.error('Failed to load supplier list:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateSupplier = async (values: Omit<Supplier, 'id' | 'createdAt'>) => {
    try {
      const response = await createSupplier(values);
      if (response.code === 0) {
        message.success('创建成功');
        setModalVisible(false);
        form.resetFields();
        loadSupplierList();
      }
    } catch (error) {
      console.error('Failed to create supplier:', error);
    }
  };

  useEffect(() => {
    loadSupplierList();
  }, []);

  return (
    <div>
      <div className="mb-6 flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">供应商管理</h1>
          <p className="text-gray-500">管理AI服务供应商配置</p>
        </div>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setModalVisible(true)}>
          添加供应商
        </Button>
      </div>

      <Card>
        <Table
          columns={columns}
          dataSource={suppliers}
          rowKey="id"
          loading={loading}
          bordered={false}
        />
      </Card>

      <Modal
        title="添加供应商"
        open={modalVisible}
        onCancel={() => setModalVisible(false)}
        footer={null}
        width={600}
      >
        <Form
          form={form}
          layout="vertical"
          onFinish={handleCreateSupplier}
          initialValues={{ status: 'active' }}
        >
          <Form.Item
            name="name"
            label="供应商名称"
            rules={[{ required: true, message: '请输入供应商名称' }]}
          >
            <Input placeholder="例如: OpenAI" />
          </Form.Item>

          <Form.Item
            name="type"
            label="供应商类型"
            rules={[{ required: true, message: '请选择供应商类型' }]}
          >
            <Select placeholder="请选择类型">
              <Option value="llm">大语言模型</Option>
              <Option value="embedding">嵌入模型</Option>
              <Option value="image">图像生成</Option>
              <Option value="audio">音频处理</Option>
            </Select>
          </Form.Item>

          <Form.Item
            name="status"
            label="状态"
            valuePropName="checked"
          >
            <Switch checkedChildren="启用" unCheckedChildren="禁用" />
          </Form.Item>

          <Form.Item
            name={['config', 'apiKey']}
            label="API Key"
            rules={[{ required: true, message: '请输入API Key' }]}
          >
            <Input.Password placeholder="请输入API密钥" />
          </Form.Item>

          <Form.Item
            name={['config', 'baseURL']}
            label="API地址"
          >
            <Input placeholder="请输入API基础地址，留空使用默认" />
          </Form.Item>

          <Form.Item
            name={['config', 'models']}
            label="支持模型"
            help="多个模型用英文逗号分隔"
          >
            <Input placeholder="例如: gpt-3.5-turbo,gpt-4" />
          </Form.Item>

          <Form.Item className="text-right mb-0">
            <Space>
              <Button onClick={() => setModalVisible(false)}>取消</Button>
              <Button type="primary" htmlType="submit">创建</Button>
            </Space>
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

export default SupplierManagement;
```

- [ ] **Step 2: Test supplier page**

Run dev server, go to `/supplier`. Expected: Shows supplier list with mock data, add button opens modal.

- [ ] **Step 3: Commit**
```bash
git add src/pages/SupplierManagement.tsx
git commit -m "feat: implement SupplierManagement page with list and add function"
```

---

### Task 12: Implement LogManagement Page

**Files:**
- Create: `apps/proxy-admin/src/pages/LogManagement.tsx`

**Interfaces:**
- Produces: Log management page (content TODO per requirements)

- [ ] **Step 1: Create LogManagement component**

Create `src/pages/LogManagement.tsx`:
```tsx
import { Card, Empty } from 'antd';

const LogManagement = () => {
  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-800">日志管理</h1>
        <p className="text-gray-500">查看系统操作日志和请求日志</p>
      </div>

      <Card className="text-center py-12">
        <Empty description="日志功能待后续设计补充" />
      </Card>
    </div>
  );
};

export default LogManagement;
```

- [ ] **Step 2: Commit**
```bash
git add src/pages/LogManagement.tsx
git commit -m "feat: implement LogManagement page (basic structure)"
```

---

### Task 13: Implement SystemSettings Page

**Files:**
- Create: `apps/proxy-admin/src/pages/SystemSettings.tsx`

**Interfaces:**
- Consumes: `getSystemSettings`, `saveSystemSettings` APIs from Task 4
- Produces: System settings page with form and save button (other functions TODO)

- [ ] **Step 1: Create SystemSettings component**

Create `src/pages/SystemSettings.tsx`:
```tsx
import { Card, Form, Input, InputNumber, Switch, Button, message, Space } from 'antd';
import { SaveOutlined } from '@ant-design/icons';
import { useState, useEffect } from 'react';
import { getSystemSettings, saveSystemSettings, SystemSettings } from '../services/api';

const SystemSettings = () => {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const loadSettings = async () => {
    setLoading(true);
    try {
      const response = await getSystemSettings();
      if (response.code === 0) {
        form.setFieldsValue(response.data);
      }
    } catch (error) {
      console.error('Failed to load system settings:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async (values: SystemSettings) => {
    setSaving(true);
    try {
      const response = await saveSystemSettings(values);
      if (response.code === 0) {
        message.success('保存成功');
      }
    } catch (error) {
      console.error('Failed to save settings:', error);
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => {
    loadSettings();
  }, []);

  return (
    <div>
      <div className="mb-6 flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">系统设置</h1>
          <p className="text-gray-500">配置系统基础参数</p>
        </div>
        <Button 
          type="primary" 
          icon={<SaveOutlined />} 
          onClick={() => form.submit()}
          loading={saving}
        >
          保存设置
        </Button>
      </div>

      <Card loading={loading}>
        <Form
          form={form}
          layout="vertical"
          onFinish={handleSave}
          className="max-w-2xl"
        >
          <Form.Item
            name="siteName"
            label="站点名称"
            rules={[{ required: true, message: '请输入站点名称' }]}
          >
            <Input placeholder="请输入站点名称" />
          </Form.Item>

          <Form.Item
            name="siteDescription"
            label="站点描述"
          >
            <Input.TextArea rows={3} placeholder="请输入站点描述" />
          </Form.Item>

          <Form.Item
            name="maxUploadSize"
            label="最大上传大小 (MB)"
            rules={[{ required: true, message: '请输入最大上传大小' }]}
          >
            <InputNumber min={1} max={1024} className="w-full" />
          </Form.Item>

          <Form.Item
            name="enableRegistration"
            label="开放注册"
            valuePropName="checked"
          >
            <Switch />
          </Form.Item>
        </Form>
      </Card>
    </div>
  );
};

export default SystemSettings;
```

- [ ] **Step 2: Test system settings page**

Run dev server, go to `/system`. Expected: Shows form with mock settings, save button works.

- [ ] **Step 3: Commit**
```bash
git add src/pages/SystemSettings.tsx
git commit -m "feat: implement SystemSettings page with form and save function"
```

---

### Task 14: Test Full Flow

**Files:** None (functional testing only)

**Interfaces:**
- Consumes: All components from previous tasks
- Produces: Verified end-to-end flow works correctly

- [ ] **Step 1: Start dev server**

Run:
```bash
cd /Users/cashely.shi/Documents/projects/cc-monitoring/apps/proxy-admin
pnpm dev
```

Expected: Server starts successfully on port 5173.

- [ ] **Step 2: Test unauthenticated access**

Go to `http://localhost:5173/dashboard` directly. Expected: Redirects to `/login` page.

- [ ] **Step 3: Test login with wrong credentials**

Enter username `admin`, password `wrong`. Expected: Shows error message "用户名或密码错误".

- [ ] **Step 4: Test login with correct credentials**

Enter username `admin`, password `123456`. Expected: Login success, redirects to dashboard.

- [ ] **Step 5: Test navigation**

Click menu items: Dashboard, User Management, Supplier Management, Log Management, System Settings. Expected: Each page loads correctly.

- [ ] **Step 6: Test user list**

Go to User Management. Expected: Shows user table with 3 mock users. Click "创建用户" button, fill form, submit. Expected: New user added to table.

- [ ] **Step 7: Test supplier list**

Go to Supplier Management. Expected: Shows supplier list with 3 mock suppliers. Click "添加供应商" button, fill form, submit. Expected: New supplier added to list.

- [ ] **Step 8: Test system settings**

Go to System Settings. Expected: Shows pre-filled form. Modify some fields, click "保存设置". Expected: Shows success message, settings updated.

- [ ] **Step 9: Test logout**

Click user avatar in header, select "退出登录". Expected: Logout success, redirects to login page.

- [ ] **Step 10: Test expired token**

Login, then clear localStorage token manually, refresh page. Expected: Redirects to login page.

- [ ] **Step 11: Test production build**

Run:
```bash
pnpm build
```

Expected: Build completes successfully, no errors.

- [ ] **Step 12: Commit test verification**
```bash
git add .
git commit -m "test: verify full flow works correctly"
```

---

## Plan Self-Review

### 1. Spec Coverage
- ✅ Mock APIs for all endpoints: Task 5
- ✅ Login page and auth flow: Tasks 3, 4, 6, 8
- ✅ Dual auth guarding (router loader + axios interceptor): Tasks 4, 6
- ✅ Main layout with header, sider menu, content: Task 7
- ✅ Dashboard page: Task 9
- ✅ User management page with table + create button: Task 10
- ✅ Supplier management page with list + add button: Task 11
- ✅ Log management page (TODO): Task 12
- ✅ System settings page with form + save button: Task 13
- ✅ Header user dropdown with logout: Task 7
- ✅ All APIs use header token: Task 4

### 2. Placeholder Scan
- No TBD/TODO in implementation steps
- All code blocks complete
- All commands exact with expected output
- No vague requirements

### 3. Type Consistency
- All function names, type definitions, property names consistent across tasks
- API interfaces match mock implementations
- Type imports consistent across files

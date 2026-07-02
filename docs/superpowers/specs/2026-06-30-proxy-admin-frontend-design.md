# Proxy Admin Frontend Design Document

**Date**: 2026-06-30
**Status**: Draft
**Author**: Claude Code

## 1. Overview
Build the proxy-admin frontend application with mock backend integration, complete auth flow, and basic page structure.

## 2. Tech Stack
- **Package Manager**: pnpm
- **UI Component Library**: Ant Design v5
- **Styling**: Tailwind CSS for custom styling, Ant Design for components
- **State Management**: React Context + useReducer for auth state
- **HTTP Client**: Axios with interceptors
- **Mock Solution**: vite-plugin-mock for API mocking
- **Routing**: React Router v6 with loaders for auth guarding

## 3. Architecture

### 3.1 Auth Flow
1. **App Entry**: 
   - React Router loader calls `getUserInfo` API on app initialization
   - If API returns 401 → redirect to `/login` page
   - If API returns user info → allow access to protected routes

2. **Login Flow**:
   - User enters username and password on login page
   - Submit credentials to `POST /api/login` API
   - On success: store token in localStorage, update auth context, redirect to dashboard
   - On failure: show error message

3. **Request Flow**:
   - All API requests automatically include `Authorization: Bearer <token>` header via axios request interceptor
   - Axios response interceptor checks for 401 responses → clear auth state, redirect to login
   - Other errors are logged and displayed to user

4. **Logout Flow**:
   - User clicks "Logout" in header dropdown
   - Call `POST /api/logout` API
   - Clear localStorage, reset auth context, redirect to login page

### 3.2 Route Structure
```
/login → Public route (no auth required)
/ → Protected layout route (requires auth)
  ├── /dashboard → Default dashboard page (content TODO)
  ├── /user → User management page (table + create button)
  ├── /supplier → AI supplier management page (list + add button)
  ├── /log → Log management page (content TODO)
  └── /system → System settings page (form + save button)
```

### 3.3 Mock APIs
All APIs have separate mock implementations:
| Method | Path | Description | Response |
|--------|------|-------------|----------|
| POST | `/api/login` | User login | `{ token: string, user: UserInfo }` |
| GET | `/api/user/info` | Get current user info | `{ user: UserInfo }` |
| POST | `/api/logout` | User logout | `{ success: boolean }` |
| GET | `/api/user/list` | Get user list | `{ list: User[], total: number }` |
| GET | `/api/supplier/list` | Get supplier list | `{ list: Supplier[], total: number }` |
| POST | `/api/system/settings` | Save system settings | `{ success: boolean }` |

### 3.4 Component Structure
```
src/
├── contexts/
│   └── AuthContext.tsx - Auth state provider with login/logout actions
├── layouts/
│   └── MainLayout.tsx - Main app layout with Header, Sider (menu), Content area
├── pages/
│   ├── Login.tsx - Login page with username/password form
│   ├── Dashboard.tsx - Dashboard page (content TODO)
│   ├── UserManagement.tsx - User management page with table and create button
│   ├── SupplierManagement.tsx - Supplier management page with list and add button
│   ├── LogManagement.tsx - Log management page (content TODO)
│   └── SystemSettings.tsx - System settings page with form and save button
├── services/
│   ├── request.ts - Axios instance with request/response interceptors
│   └── api.ts - API service functions for all endpoints
├── mock/
│   ├── user.ts - Mock for user related APIs
│   ├── supplier.ts - Mock for supplier related APIs
│   └── system.ts - Mock for system related APIs
└── router/
    └── index.tsx - Route definitions with auth loader guards
```

## 4. Implementation Guidelines
1. Follow TypeScript strict mode for all code
2. Use Ant Design components for all UI elements, Tailwind CSS for custom styling
3. Mock implementations should return realistic sample data
4. All API calls should be wrapped in service functions in `services/api.ts`
5. Auth state should only be modified through context actions
6. Error handling should be consistent across all pages
7. Follow project directory structure and naming conventions

## 5. Next Steps
1. Install required dependencies (vite-plugin-mock, tailwindcss, postcss, autoprefixer)
2. Configure Tailwind CSS in project
3. Implement AuthContext with login/logout actions
4. Update axios request interceptor to add auth token
5. Add response interceptor to handle 401 redirects
6. Implement mock API files
7. Update router with protected routes and auth loaders
8. Implement MainLayout component with header, menu, content area
9. Implement all page components
10. Test full flow from login to logout

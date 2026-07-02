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

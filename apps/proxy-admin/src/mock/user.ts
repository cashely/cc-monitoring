import { MockMethod } from 'vite-plugin-mock';
import { UserInfo } from '../types/auth';

const mockUsers: UserInfo[] = [
  {
    id: 1,
    username: 'admin',
    nickname: 'Administrator',
    avatar: 'https://api.dicebear.com/7.x/avataaars.svg?seed=admin',
    email: 'admin@example.com',
  },
  {
    id: 2,
    username: 'user1',
    nickname: 'Normal User',
    avatar: 'https://api.dicebear.com/7.x/avataaars.svg?seed=user1',
    email: 'user1@example.com',
  },
  {
    id: 3,
    username: 'user2',
    nickname: 'Test User',
    avatar: 'https://api.dicebear.com/7.x/avataaars.svg?seed=user2',
    email: 'user2@example.com',
  },
];

export default [
  // Login API
  {
    url: '/api/login',
    method: 'post',
    response: ({ body }: { body: { username: string; password: string } }) => {
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
    response: ({ headers }: { headers: { authorization?: string } }) => {
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
    response: ({ query }: { query: { page?: string; pageSize?: string } }) => {
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
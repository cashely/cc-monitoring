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
    response: ({ query }: { query: { page?: string; pageSize?: string } }) => {
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
    response: ({ body }: { body: Omit<Supplier, 'id' | 'createdAt'> }) => {
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
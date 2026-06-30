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
    response: ({ body }: { body: Partial<SystemSettings> }) => {
      Object.assign(mockSettings, body);
      return {
        code: 0,
        message: '保存成功',
        data: { success: true },
      };
    },
  },
] as MockMethod[];
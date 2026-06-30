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
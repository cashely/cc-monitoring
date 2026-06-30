import request from './request';
import { UserInfo, LoginParams } from '../types/auth';

export interface ApiResponse<T = any> {
  code: number;
  message: string;
  data: T;
}

// Auth APIs
export const login = (params: LoginParams): Promise<ApiResponse<{ token: string; user: UserInfo }>> => {
  return request.post('/login', params);
};

export const logout = (): Promise<ApiResponse<{ success: boolean }>> => {
  return request.post('/logout');
};

export const getUserInfo = (): Promise<ApiResponse<{ user: UserInfo }>> => {
  return request.get('/user/info');
};

// User management APIs
export const getUserList = (params?: { page?: number; pageSize?: number }): Promise<ApiResponse<{ list: UserInfo[]; total: number }>> => {
  return request.get('/user/list', { params });
};

export const createUser = (params: Omit<UserInfo, 'id'>): Promise<ApiResponse<UserInfo>> => {
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

export const getSupplierList = (params?: { page?: number; pageSize?: number }): Promise<ApiResponse<{ list: Supplier[]; total: number }>> => {
  return request.get('/supplier/list', { params });
};

export const createSupplier = (params: Omit<Supplier, 'id' | 'createdAt'>): Promise<ApiResponse<Supplier>> => {
  return request.post('/supplier', params);
};

// System settings APIs
export interface SystemSettings {
  siteName: string;
  siteDescription: string;
  maxUploadSize: number;
  enableRegistration: boolean;
}

export const getSystemSettings = (): Promise<ApiResponse<SystemSettings>> => {
  return request.get('/system/settings');
};

export const saveSystemSettings = (params: SystemSettings): Promise<ApiResponse<{ success: boolean }>> => {
  return request.post('/system/settings', params);
};
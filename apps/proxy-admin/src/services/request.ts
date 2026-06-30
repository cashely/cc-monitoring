import axios, { AxiosRequestConfig } from 'axios';
import { message } from 'antd';

// Create axios instance
const instance = axios.create({
  baseURL: import.meta.env.VITE_API_PREFIX || '/api',
  timeout: 10000,
});

// Wrapper to return response.data directly with correct type
const request = <T = any>(config: AxiosRequestConfig): Promise<T> => {
  return instance(config) as unknown as Promise<T>;
};

// Add get/post/put/delete shortcut methods
request.get = <T = any>(url: string, config?: AxiosRequestConfig): Promise<T> => {
  return request({ ...config, method: 'GET', url });
};

request.post = <T = any>(url: string, data?: any, config?: AxiosRequestConfig): Promise<T> => {
  return request({ ...config, method: 'POST', url, data });
};

request.put = <T = any>(url: string, data?: any, config?: AxiosRequestConfig): Promise<T> => {
  return request({ ...config, method: 'PUT', url, data });
};

request.delete = <T = any>(url: string, config?: AxiosRequestConfig): Promise<T> => {
  return request({ ...config, method: 'DELETE', url });
};

// Request interceptor - add auth token
instance.interceptors.request.use(
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
instance.interceptors.response.use(
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
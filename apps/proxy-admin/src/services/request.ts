import axios from 'axios';

// 创建axios实例
const request = axios.create({
  baseURL: import.meta.env.VITE_API_PREFIX,
  timeout: 10000,
});

// 请求拦截器
request.interceptors.request.use(
  (config) => {
    // 这里可以添加token等认证信息
    // const token = localStorage.getItem('token');
    // if (token) {
    //   config.headers.Authorization = `Bearer ${token}`;
    // }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  },
);

// 响应拦截器
request.interceptors.response.use(
  (response) => {
    return response.data;
  },
  (error) => {
    // 统一错误处理
    console.error('请求错误:', error);
    return Promise.reject(error);
  },
);

export default request;
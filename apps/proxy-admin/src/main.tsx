import React from 'react';
import ReactDOM from 'react-dom/client';
import { ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import Router from './router';
import { AuthProvider } from './contexts/AuthContext';
import 'antd/dist/reset.css';
import './styles/global.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AuthProvider>
      <ConfigProvider locale={zhCN}>
        <Router />
      </ConfigProvider>
    </AuthProvider>
  </React.StrictMode>,
);
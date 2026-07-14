import React from 'react'
import ReactDOM from 'react-dom/client'
import { ConfigProvider, theme } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import Router from './router'
import { AuthProvider } from './contexts/AuthContext'
import 'antd/dist/reset.css'
import './styles/global.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AuthProvider>
      <ConfigProvider
        locale={zhCN}
        theme={{
          algorithm: theme.darkAlgorithm,
          token: {
            colorPrimary: '#3B82F6',
            borderRadius: 6,
            fontSize: 12,
          },
          components: {
            Button: {
              contentFontSize: 12,
            },
          },
        }}
      >
        <Router />
      </ConfigProvider>
    </AuthProvider>
  </React.StrictMode>,
)

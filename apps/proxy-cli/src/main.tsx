import React from 'react'
import ReactDOM from 'react-dom/client'
import { ConfigProvider, theme } from 'antd'
import { App } from './App'
import './index.css'
import './i18n'
import i18n from './i18n'

document.title = i18n.t('app:title')

const rootElement = document.getElementById('root')
if (!rootElement) {
  throw new Error('Could not find root element to mount to')
}

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <ConfigProvider
      theme={{
        algorithm: theme.darkAlgorithm,
        token: {
          colorPrimary: '#3B82F6',
          borderRadius: 6,
        },
        components: {
          Button: {
            borderRadius: 6,
            contentFontSize: 14,
            controlHeight: 32,
            controlHeightSM: 24,
            controlHeightLG: 40,
          },
          Table: {
            headerBg: '#1F2937',
            rowHoverBg: '#374151',
          },
        },
      }}
    >
      <App />
    </ConfigProvider>
  </React.StrictMode>
)

import React from 'react'
import ReactDOM from 'react-dom/client'
import { ConfigProvider, theme } from 'antd'
import { App } from './App'
import './index.css'
import './i18n'
import i18n from './i18n'
import { ThemeProvider, useTheme } from './hooks'

document.title = i18n.t('app:title')

const ThemedApp = () => {
  const { theme: appTheme } = useTheme()

  return (
    <ConfigProvider
      theme={{
        algorithm: appTheme === 'dark' ? theme.darkAlgorithm : theme.defaultAlgorithm,
        token: {
          colorPrimary: '#3B82F6',
          borderRadius: 6,
          fontSize: 12,
        },
        components: {
          Button: {
            borderRadius: 6,
            contentFontSize: 12,
            controlHeight: 32,
            controlHeightSM: 24,
            controlHeightLG: 40,
          },
          Table: {
            headerBg: appTheme === 'dark' ? '#1F2937' : '#F1F5F9',
            rowHoverBg: appTheme === 'dark' ? '#374151' : '#F1F5F9',
          },
        },
      }}
    >
      <App />
    </ConfigProvider>
  )
}

const rootElement = document.getElementById('root')
if (!rootElement) {
  throw new Error('Could not find root element to mount to')
}

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <ThemeProvider>
      <ThemedApp />
    </ThemeProvider>
  </React.StrictMode>
)

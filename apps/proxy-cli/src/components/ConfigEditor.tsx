import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { fetchConfig, saveConfig, fetchStatus } from '../api'
import { AppConfig } from '../types/config'
import { ProviderManagerModal } from './ProviderManagerModal'

const DEFAULT_CONFIG: AppConfig = {
  server: { port: 3000, host: 'localhost' },
  proxy: { target: 'https://token-plan.cn-beijing.maas.aliyuncs.com/apps/anthropic', changeOrigin: true },
  logging: { level: 'info', file: 'logs/proxy.log' }
}

export function ConfigEditor(): JSX.Element {
  const { t } = useTranslation('config')
  const [config, setConfig] = useState<AppConfig>(DEFAULT_CONFIG)
  const [errors, setErrors] = useState<Array<{ field: string; message: string }>>([])
  const [message, setMessage] = useState<string | null>(null)
  const [messageType, setMessageType] = useState<'success' | 'error' | 'restarting'>('success')
  const [autoReload, setAutoReload] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [isRestarting, setIsRestarting] = useState(false)
  const [isProviderModalOpen, setIsProviderModalOpen] = useState(false)

  useEffect(() => {
    loadConfig()
  }, [])

  const loadConfig = async () => {
    try {
      const data = await fetchConfig()
      setConfig(data.config)
    } catch {
      // Ignore errors - keep default config
    }
  }

  const handleSave = async () => {
    setIsSaving(true)
    setMessage(null)

    const result = await saveConfig(config, autoReload)
    if (result.success) {
      if (result.reloaded) {
        // 显示重启中状态
        setMessage(t('message.restarting'))
        setMessageType('restarting')
        setIsRestarting(true)
        setErrors([])

        // 高频轮询状态，直到恢复
        const pollInterval = setInterval(async () => {
          try {
            const status = await fetchStatus()
            if (status.status === 'online') {
              clearInterval(pollInterval)
              setIsRestarting(false)
              setMessage(t('message.savedAndReloaded'))
              setMessageType('success')
              // 3秒后自动清除消息
              setTimeout(() => setMessage(null), 3000)
            }
          } catch {
            // 重启过程中请求可能失败，忽略
          }
        }, 1000)

        // 30秒超时保护
        setTimeout(() => {
          clearInterval(pollInterval)
          setIsRestarting(current => {
            if (current) {
              setMessage(t('message.restartTimeout'))
              setMessageType('error')
            }
            return false
          })
        }, 30000)
      } else if (result.reloadError) {
        setMessage(t('message.savedButReloadFailed', { error: result.reloadError }))
        setMessageType('error')
      } else {
        setMessage(t('message.savedSuccess'))
        setMessageType('success')
        // 3秒后自动清除消息
        setTimeout(() => setMessage(null), 3000)
      }
      setErrors([])
    } else {
      setErrors(result.errors || [])
      setMessage(null)
    }

    setIsSaving(false)
  }

  const handleReset = () => {
    setConfig(DEFAULT_CONFIG)
    setErrors([])
    setMessage(null)
  }

  return (
    <div>
      <h3 className="flex justify-between items-center text-base font-medium mb-4 pb-1 border-b border-border">
        {t('heading')}
        <button
          onClick={() => setIsProviderModalOpen(true)}
          className="px-3 py-1 rounded border border-border bg-bg-secondary text-text-primary hover:bg-bg-hover transition-colors text-sm"
        >
          {t('action.manageProviders')}
        </button>
      </h3>

      <div className="mb-4">
        <h4 className="text-sm font-medium mb-2 text-text-muted">{t('section.server')}</h4>
        <div className="space-y-2">
          <label className="block">
            <span className="text-sm">{t('common:label.host')}:</span>
            <input
              type="text"
              value={config.server.host}
              onChange={(e) => setConfig({ ...config, server: { ...config.server, host: e.target.value } })}
              className="w-full mt-1 px-2 py-1 rounded border border-border bg-bg-secondary text-text-primary focus:border-primary focus:outline-none transition-colors"
            />
          </label>
          <label className="block">
            <span className="text-sm">{t('common:label.port')}:</span>
            <input
              type="number"
              value={config.server.port}
              onChange={(e) => setConfig({ ...config, server: { ...config.server, port: parseInt(e.target.value) } })}
              className="w-full mt-1 px-2 py-1 rounded border border-border bg-bg-secondary text-text-primary focus:border-primary focus:outline-none transition-colors"
            />
          </label>
        </div>
      </div>

      <div className="mb-4">
        <h4 className="text-sm font-medium mb-2 text-text-muted">{t('section.proxy')}</h4>
        <div className="space-y-2">
          <label className="block">
            <span className="text-sm">{t('common:label.target')}:</span>
            <input
              type="text"
              value={config.proxy.target}
              onChange={(e) => setConfig({ ...config, proxy: { ...config.proxy, target: e.target.value } })}
              className="w-full mt-1 px-2 py-1 rounded border border-border bg-bg-secondary text-text-primary focus:border-primary focus:outline-none transition-colors"
            />
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={config.proxy.changeOrigin}
              onChange={(e) => setConfig({ ...config, proxy: { ...config.proxy, changeOrigin: e.target.checked } })}
              className="w-4 h-4 rounded border-border bg-bg-secondary accent-primary"
            />
            <span className="text-sm">{t('common:label.changeOrigin')}</span>
          </label>
        </div>
      </div>

      <div className="mb-4">
        <h4 className="text-sm font-medium mb-2 text-text-muted">{t('section.logging')}</h4>
        <label className="block">
          <span className="text-sm">{t('common:label.level')}:</span>
          <select
            value={config.logging.level}
            onChange={(e) => setConfig({ ...config, logging: { ...config.logging, level: e.target.value as any } })}
            className="w-full mt-1 px-2 py-1 rounded border border-border bg-bg-secondary text-text-primary focus:border-primary focus:outline-none transition-colors"
          >
            <option value="debug">{t('common:level.debug')}</option>
            <option value="info">{t('common:level.info')}</option>
            <option value="warn">{t('common:level.warn')}</option>
            <option value="error">{t('common:level.error')}</option>
          </select>
        </label>
      </div>

      <div className="mb-4">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={autoReload}
            onChange={(e) => setAutoReload(e.target.checked)}
            className="w-4 h-4 rounded border-border bg-bg-secondary accent-primary"
          />
          <span className="text-sm">{t('label.autoReload')}</span>
        </label>
      </div>

      {errors.length > 0 && (
        <div className="bg-error/10 p-2 mb-2 rounded">
          {errors.map((err, i) => (
            <div key={i} className="text-error text-sm">
              {t('error.fieldMessage', { field: err.field, message: err.message })}
            </div>
          ))}
        </div>
      )}

      {message && (
        <div className={`p-2 mb-2 rounded ${
          messageType === 'success' ? 'bg-success/10 text-success' :
          messageType === 'restarting' ? 'bg-warning/10 text-warning animate-pulse' :
          'bg-error/10 text-error'
        }`}>
          {message}
        </div>
      )}

      <div className="flex gap-2">
        <button
          onClick={handleSave}
          disabled={isSaving || isRestarting}
          className="px-4 py-2 rounded bg-primary text-white hover:bg-primary-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isSaving || isRestarting ? t('common:action.saving') : t('common:action.save')}
        </button>
        <button
          onClick={handleReset}
          disabled={isSaving || isRestarting}
          className="px-4 py-2 rounded border border-border bg-bg-secondary text-text-primary hover:bg-bg-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {t('common:action.resetDefault')}
        </button>
      </div>

      <ProviderManagerModal
        isOpen={isProviderModalOpen}
        onClose={() => setIsProviderModalOpen(false)}
      />
    </div>
  )
}
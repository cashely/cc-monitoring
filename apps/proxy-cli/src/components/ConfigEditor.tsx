import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { fetchConfig, fetchStatus, controlProcess } from '../api'
import { ProviderManagerModal } from './ProviderManagerModal'
import { DatabaseZap, RefreshCw } from 'lucide-react'
import { GlowCard } from './GlowCard'
import { TOKEN_COLORS } from './chart-theme'

export function ConfigEditor(): JSX.Element {
  const { t } = useTranslation('config')
  const [message, setMessage] = useState<string | null>(null)
  const [messageType, setMessageType] = useState<'success' | 'error' | 'restarting'>('success')
  const [isRestarting, setIsRestarting] = useState(false)
  const [isProviderModalOpen, setIsProviderModalOpen] = useState(false)
  const [configPath, setConfigPath] = useState<string | null>(null)

  useEffect(() => {
    fetchConfig().then(data => {
      if ('configPath' in data) {
        setConfigPath(data.configPath as string)
      }
    }).catch(() => {
      // 忽略获取配置路径失败
    })
  }, [])

  const handleRestart = async () => {
    setIsRestarting(true)
    setMessage(t('message.restarting'))
    setMessageType('restarting')

    try {
      await controlProcess('restart')
    } catch {
      // 请求可能失败（连接被拒绝），但服务可能正在重启
      // 继续轮询即可
    }

    // UI端延迟2秒再开始轮询，配合服务端延迟1秒重启
    await new Promise(resolve => setTimeout(resolve, 2000))

    const startTime = Date.now()
    const minWaitTime = 3000 // 至少再等待3秒

    // 高频轮询状态，直到恢复
    const pollInterval = setInterval(async () => {
      const elapsed = Date.now() - startTime
      try {
        const status = await fetchStatus()
        // 等待至少 minWaitTime 后，只要看到 online 就认为成功
        if (elapsed >= minWaitTime && status.status === 'online') {
          clearInterval(pollInterval)
          setIsRestarting(false)
          setMessage(t('message.savedAndReloaded'))
          setMessageType('success')
          // 3秒后自动清除消息
          setTimeout(() => setMessage(null), 3000)
        }
      } catch {
        // 重启过程中请求可能失败，继续轮询
      }
    }, 800)

    // 45秒超时保护
    setTimeout(() => {
      clearInterval(pollInterval)
      setIsRestarting(current => {
        if (current) {
          setMessage(t('message.restartTimeout'))
          setMessageType('error')
        }
        return false
      })
    }, 45000)
  }

  return (
    <div>
      <h3 className="flex justify-between items-center text-base font-medium mb-4 pb-1 border-b border-border">
        {t('heading')}
        <div className="flex gap-2">
          <button
            onClick={handleRestart}
            disabled={isRestarting}
            title={t('action.restartServer')}
            className="flex items-center gap-1 px-3 py-1.5 rounded border border-border bg-bg-secondary text-text-primary hover:bg-bg-hover transition-colors disabled:opacity-50"
          >
            <RefreshCw size={16} className={isRestarting ? 'animate-spin' : ''} />
            <span className="text-sm">{isRestarting ? t('common:action.restarting') : t('common:action.restart')}</span>
          </button>
          <button
            onClick={() => setIsProviderModalOpen(true)}
            title={t('action.manageProviders')}
            className="flex items-center p-1.5 rounded border border-border bg-bg-secondary text-text-primary hover:bg-bg-hover transition-colors"
          >
            <DatabaseZap size={16} />
          </button>
        </div>
      </h3>

      <div className="mb-4">
        <h4 className="text-sm font-medium mb-2 text-text-muted">{t('section.server')}</h4>
        <div className="space-y-2">
          <GlowCard color={TOKEN_COLORS.input}>
            <div className="text-sm font-medium text-text-muted mb-1">{t('common:label.address')}</div>
            <div className="text-text-primary font-mono">
              http://localhost:9527
            </div>
          </GlowCard>
          <GlowCard color={TOKEN_COLORS.output}>
            <div className="text-sm font-medium text-text-muted mb-1">{t('common:label.configPath')}</div>
            <div className="text-text-primary font-mono text-sm break-all">
              {configPath ? configPath.replace(/\/config\.json$/, '') : '~/.cc-monitoring'}
            </div>
          </GlowCard>
        </div>
      </div>

      {message && (
        <div className={`p-2 mb-2 rounded ${
          messageType === 'success' ? 'bg-success/10 text-success' :
          messageType === 'restarting' ? 'bg-warning/10 text-warning animate-pulse' :
          'bg-error/10 text-error'
        }`}>
          {message}
        </div>
      )}

      <ProviderManagerModal
        isOpen={isProviderModalOpen}
        onClose={() => setIsProviderModalOpen(false)}
      />
    </div>
  )
}

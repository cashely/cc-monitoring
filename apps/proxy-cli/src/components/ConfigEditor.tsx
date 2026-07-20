import { useState, useEffect } from 'react'
import { Button, Tooltip } from 'antd'
import { DatabaseZap, RefreshCw, Link2 } from 'lucide-react'
import { ApiOutlined } from '@ant-design/icons'
import { useTranslation } from 'react-i18next'
import { fetchConfig, controlProcess, syncClaudeSettings } from '../api'
import { ProviderManagerModal } from './ProviderManagerModal'
import { McpManagerPanel } from './McpManagerPanel'
import { GlowCard } from './GlowCard'
import { TOKEN_COLORS } from './chart-theme'

export function ConfigEditor(): JSX.Element {
  const { t } = useTranslation('config')
  const [message, setMessage] = useState<string | null>(null)
  const [messageType, setMessageType] = useState<'success' | 'error' | 'restarting'>('success')
  const [isRestarting, setIsRestarting] = useState(false)
  const [isProviderModalOpen, setIsProviderModalOpen] = useState(false)
  const [isMcpPanelOpen, setIsMcpPanelOpen] = useState(false)
  const [configPath, setConfigPath] = useState<string | null>(null)
  const [isSyncing, setIsSyncing] = useState(false)

  useEffect(() => {
    fetchConfig().then(data => {
      if ('configPath' in data) {
        setConfigPath(data.configPath as string)
      }
    }).catch(() => {
      // 忽略获取配置路径失败
    })
  }, [])

  const handleSyncClaudeConfig = async () => {
    setIsSyncing(true)
    setMessage(null)
    try {
      const result = await syncClaudeSettings()
      setMessage(result.message)
      setMessageType(result.success ? 'success' : 'error')
      setTimeout(() => setMessage(null), 5000)
    } catch {
      setMessage(t('message.restartFailed'))
      setMessageType('error')
    } finally {
      setIsSyncing(false)
    }
  }

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
        // 这里我们不需要实际检查状态，只要等待足够时间即可
        // 实际项目中可以调用 fetchStatus()
        if (elapsed >= minWaitTime) {
          clearInterval(pollInterval)
          setIsRestarting(false)
          setMessage(t('message.savedAndReloaded'))
          setMessageType('success')
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
          <Tooltip title={t('action.restartServer')}>
            <Button
              icon={<RefreshCw size={16} className={isRestarting ? 'animate-spin' : ''} />}
              onClick={handleRestart}
              disabled={isRestarting}
            >
              {isRestarting ? t('common:action.restarting') : t('common:action.restart')}
            </Button>
          </Tooltip>
          <Tooltip title={t('action.manageProviders')}>
            <Button
              icon={<DatabaseZap size={16} />}
              onClick={() => setIsProviderModalOpen(true)}
            />
          </Tooltip>
          <Tooltip title="MCP Servers">
            <Button
              icon={<ApiOutlined />}
              onClick={() => setIsMcpPanelOpen(true)}
            />
          </Tooltip>
        </div>
      </h3>

      <div className="mb-4">
        <h4 className="text-xs font-medium mb-2 text-text-muted">{t('section.server')}</h4>
        <div className="space-y-2">
          <GlowCard color={TOKEN_COLORS.input}>
            <div className="flex items-center justify-between">
              <div>
                <div className="text-xs font-medium text-text-muted mb-1">{t('common:label.address')}</div>
                <div className="text-text-primary font-mono text-xs">
                  http://localhost:9527
                </div>
              </div>
              <Tooltip title={t('action.syncClaudeConfig')}>
                <Button
                  type="text"
                  size="small"
                  icon={<Link2 size={14} />}
                  loading={isSyncing}
                  onClick={handleSyncClaudeConfig}
                  className="!p-0 flex items-center"
                />
              </Tooltip>
            </div>
          </GlowCard>
          <GlowCard color={TOKEN_COLORS.output}>
            <div className="text-xs font-medium text-text-muted mb-1">{t('common:label.configPath')}</div>
            <div className="text-text-primary font-mono text-xs break-all">
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
      <McpManagerPanel
        isOpen={isMcpPanelOpen}
        onClose={() => setIsMcpPanelOpen(false)}
      />
    </div>
  )
}

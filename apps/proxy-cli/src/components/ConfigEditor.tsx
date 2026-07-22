import { useState, useEffect } from 'react'
import { Button, Tooltip } from 'antd'
import { Link2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { fetchConfig, syncClaudeSettings } from '../api'
import { GlowCard } from './GlowCard'
import { TOKEN_COLORS } from './chart-theme'

export function ConfigEditor(): JSX.Element {
  const { t } = useTranslation('config')
  const [message, setMessage] = useState<string | null>(null)
  const [messageType, setMessageType] = useState<'success' | 'error' | 'restarting'>('success')
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

  return (
    <div>
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
    </div>
  )
}

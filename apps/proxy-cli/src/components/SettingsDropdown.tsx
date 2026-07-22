import { useState } from 'react'
import { Settings, RefreshCw, DatabaseZap, BookOpen } from 'lucide-react'
import { ApiOutlined } from '@ant-design/icons'
import { useTranslation } from 'react-i18next'
import { controlProcess } from '../api'
import { ProviderManagerModal } from './ProviderManagerModal'
import { McpManagerPanel } from './McpManagerPanel'

export function SettingsDropdown(): JSX.Element {
  const { t } = useTranslation('settings')
  const { t: tc } = useTranslation('common')
  const [isRestarting, setIsRestarting] = useState(false)
  const [isProviderModalOpen, setIsProviderModalOpen] = useState(false)
  const [isMcpPanelOpen, setIsMcpPanelOpen] = useState(false)

  const handleRestart = async () => {
    setIsRestarting(true)
    try {
      await controlProcess('restart')
    } catch {
      // 请求可能失败（连接被拒绝），但服务可能正在重启
    }
    // UI端延迟2秒再开始轮询，配合服务端延迟1秒重启
    await new Promise(resolve => setTimeout(resolve, 2000))

    const startTime = Date.now()
    const minWaitTime = 3000

    const pollInterval = setInterval(async () => {
      const elapsed = Date.now() - startTime
      try {
        if (elapsed >= minWaitTime) {
          clearInterval(pollInterval)
          setIsRestarting(false)
        }
      } catch {
        // 重启过程中请求可能失败，继续轮询
      }
    }, 800)

    // 45秒超时保护
    setTimeout(() => {
      clearInterval(pollInterval)
      setIsRestarting(current => {
        if (current) setIsRestarting(false)
        return false
      })
    }, 45000)
  }

  const handleViewDocs = () => {
    window.open(location.origin + '/docs', '_blank')
  }

  return (
    <>
      <div className="relative group/settings">
        <button
          className="flex items-center justify-center w-8 h-8 rounded-lg hover:bg-bg-hover transition-colors"
          aria-label={t('menu.viewDocs')}
        >
          <Settings size={16} className="text-text-muted group-hover/settings:text-text-primary transition-colors" />
        </button>

        {/* Dropdown — appears on hover */}
        <div className="absolute right-0 top-full mt-1 w-48 glass-strong rounded-xl py-1 opacity-0 invisible group-hover/settings:opacity-100 group-hover/settings:visible transition-all duration-200 z-50">
          <button
            onClick={handleRestart}
            disabled={isRestarting}
            className="w-full flex items-center gap-2 px-3 py-2 text-xs text-text-primary hover:bg-bg-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <RefreshCw size={14} className={isRestarting ? 'animate-spin' : ''} />
            {isRestarting ? tc('action.restarting') : t('menu.restart')}
          </button>
          <button
            onClick={() => setIsProviderModalOpen(true)}
            className="w-full flex items-center gap-2 px-3 py-2 text-xs text-text-primary hover:bg-bg-hover transition-colors"
          >
            <DatabaseZap size={14} />
            {t('menu.providers')}
          </button>
          <button
            onClick={() => setIsMcpPanelOpen(true)}
            className="w-full flex items-center gap-2 px-3 py-2 text-xs text-text-primary hover:bg-bg-hover transition-colors"
          >
            <ApiOutlined style={{ fontSize: 14 }} />
            {t('menu.mcpServers')}
          </button>
          <div className="my-1 border-t border-border" />
          <button
            onClick={handleViewDocs}
            className="w-full flex items-center gap-2 px-3 py-2 text-xs text-text-primary hover:bg-bg-hover transition-colors"
          >
            <BookOpen size={14} />
            {t('menu.viewDocs')}
          </button>
        </div>
      </div>

      <ProviderManagerModal
        isOpen={isProviderModalOpen}
        onClose={() => setIsProviderModalOpen(false)}
      />
      <McpManagerPanel
        isOpen={isMcpPanelOpen}
        onClose={() => setIsMcpPanelOpen(false)}
      />
    </>
  )
}

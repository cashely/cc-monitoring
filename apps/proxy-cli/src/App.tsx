import { StatusLineChart } from './components/StatusLineChart'
import { ConfigEditor } from './components/ConfigEditor'
import { RequestHistory } from './components/RequestHistory'
import { LanguageSwitcher } from './components/LanguageSwitcher'
import { ThemeSwitcher } from './components/ThemeSwitcher'
import { StatsBarChart } from './components/StatsBarChart'
import { ChatUI } from './components/ChatUI'
import { ConnectionBanner } from './components/ConnectionBanner'
import { useTranslation } from 'react-i18next'
import { useConfig, useWebSocketData } from './hooks'

export function App(): JSX.Element {
  const { t } = useTranslation('app')
  const { versions } = useConfig()
  const { status, history, requests, stats, todayStats, connectionState, loading } =
    useWebSocketData()
  const memoryHistory = (history || []).map(p => ({ ...p, memoryMB: p.memory / 1024 / 1024 }))

  return (
    <div className="min-h-screen flex flex-col bg-bg-primary text-text-primary relative overflow-hidden">
      {/* Ambient background blobs */}
      <div className="ambient-blob blob-1" />
      <div className="ambient-blob blob-2" />
      <div className="ambient-blob blob-3" />

      {/* Content layer above blobs */}
      <div className="content-layer flex flex-col min-h-screen">
        <ConnectionBanner connected={connectionState !== 'disconnected'} />

        <header className="bg-bg-secondary/80 backdrop-blur-xl px-2 py-2 flex justify-between items-center border-b border-border">
          <div className="flex items-center gap-2">
            <h1 className="text-base font-semibold">
              {t('title')}
              {versions && (
                <sup className="text-[10px] px-1 rounded bg-accent/20 text-accent font-medium ml-0.5">
                  {versions.projectVersion}
                </sup>
              )}
            </h1>
          </div>
          <div className="flex items-center gap-2">
            {versions && (
              <span className="text-xs text-text-muted">
                {t('versions.claudeCode')}: {versions.claudeVersion}
                <span className="ml-1 text-text-muted">机器码: {versions.machineId ?? ''}</span>
              </span>
            )}
            <LanguageSwitcher />
            <ThemeSwitcher />
          </div>
        </header>

        {/* Token stats bar chart + ChatUI */}
        <div className="px-2 py-2 flex gap-2">
          <div className="flex-1">
            <StatsBarChart stats={stats} todayStats={todayStats} />
          </div>
          <div className="w-[420px]">
            <ChatUI />
          </div>
        </div>

        {/* CPU / Memory / Config middle row */}
        <div className="px-2 py-2 flex gap-2">
          <div className="flex-1 glass rounded-xl p-4">
            <h4 className="text-xs text-text-muted mb-1">{t('status:cpuChart')}</h4>
            <StatusLineChart data={history || []} metric="cpu" height={120} />
          </div>
          <div className="flex-1 glass rounded-xl p-4">
            <h4 className="text-xs text-text-muted mb-1">{t('status:memoryChart')}</h4>
            <StatusLineChart data={memoryHistory} metric="memoryMB" height={120} />
          </div>
          <div className="flex-1 glass rounded-xl p-4 overflow-y-auto">
            <ConfigEditor />
          </div>
        </div>

        <main className="flex-1 flex flex-col px-2 pb-2 min-h-0">
          <div className="flex-1 glass rounded-xl overflow-y-auto min-h-0">
            <RequestHistory requests={requests} loading={loading} />
          </div>
        </main>
      </div>
    </div>
  )
}

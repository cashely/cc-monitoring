import { StatusPanel } from './components/StatusPanel'
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
            <h1 className="text-base font-semibold">{t('title')}</h1>
            {versions && (
              <span className="text-xs px-1.5 py-0.5 rounded bg-accent/20 text-accent font-medium">
                v{versions.projectVersion}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {versions && (
              <span className="text-xs text-text-muted">
                {t('versions.claudeCode')}: {versions.claudeVersion}
                <span className="ml-1 text-text-muted/60">#{versions.machineId.slice(0, 8)}</span>
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
          <div className="w-96">
            <ChatUI />
          </div>
        </div>

        <main className="flex-1 flex gap-2 px-2 pb-2">
          <section className="flex-1 rounded-xl overflow-hidden relative glass">
            <div className="absolute inset-0 overflow-y-auto">
              <RequestHistory requests={requests} loading={loading} />
            </div>
          </section>
          <section className="w-96 flex flex-col gap-4">
            <div className="glass rounded-xl p-4">
              <StatusPanel status={{ ...status, history }} />
            </div>
            <div className="glass rounded-xl p-4 overflow-y-auto">
              <ConfigEditor />
            </div>
          </section>
        </main>
      </div>
    </div>
  )
}

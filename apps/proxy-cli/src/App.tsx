import { StatusPanel } from './components/StatusPanel'
import { ConfigEditor } from './components/ConfigEditor'
import { RequestHistory } from './components/RequestHistory'
import { LanguageSwitcher } from './components/LanguageSwitcher'
import { StatsBarChart } from './components/StatsBarChart'
import { ConnectionBanner } from './components/ConnectionBanner'
import { useTranslation } from 'react-i18next'
import { useConfig, useWebSocketData } from './hooks'

export function App(): JSX.Element {
  const { t } = useTranslation('app')
  const { versions } = useConfig()
  const { status, history, requests, stats, connectionState, loading } = useWebSocketData()

  return (
    <div className="min-h-screen flex flex-col bg-bg-primary text-text-primary">
      <ConnectionBanner connected={connectionState !== 'disconnected'} />

      <header className="bg-bg-secondary px-6 py-4 flex justify-between items-center border-b border-border">
        <div className="flex items-center gap-4">
          <h1 className="text-base font-semibold">{t('title')}</h1>
          <LanguageSwitcher />
        </div>
        {versions && (
          <div className="flex items-center gap-4 text-sm text-text-secondary">
            <span>{t('versions.claudeCode')}: {versions.claudeVersion}</span>
            <span>{t('versions.project')}: v{versions.projectVersion}</span>
          </div>
        )}
      </header>

      {/* Token stats bar chart */}
      <div className="px-4 py-2">
        <StatsBarChart stats={stats} />
      </div>

      <main className="flex-1 flex gap-4 p-4">
        <section className="flex-1 bg-bg-card rounded-lg overflow-hidden relative">
          <div className="absolute inset-0 p-4 overflow-y-auto">
            <RequestHistory requests={requests} loading={loading} />
          </div>
        </section>
        <section className="w-96 flex flex-col gap-4">
          <div className="bg-bg-card rounded-lg p-4">
            <StatusPanel status={{ ...status, history }} />
          </div>
          <div className="bg-bg-card rounded-lg p-4 flex-1 overflow-y-auto max-h-panel">
            <ConfigEditor />
          </div>
        </section>
      </main>
    </div>
  )
}

import { useTranslation } from 'react-i18next'
import { TodayStats } from '../types/stats'
import { TOKEN_COLORS } from './chart-theme'

interface Props {
  today: TodayStats
}

// 大数字千分位格式化
function formatNumber(n: number): string {
  return n.toLocaleString('en-US')
}

export function TodayStatsCards({ today }: Props): JSX.Element {
  const { t } = useTranslation('app')

  const cards = [
    { key: 'input', label: t('today.inputTokens'), value: today.input_tokens, color: TOKEN_COLORS.input },
    { key: 'output', label: t('today.outputTokens'), value: today.output_tokens, color: TOKEN_COLORS.output },
    { key: 'cache', label: t('today.cacheTokens'), value: today.cache_read_tokens, color: TOKEN_COLORS.cacheRead },
    { key: 'requests', label: t('today.requestCount'), value: today.request_count, color: TOKEN_COLORS.cacheCreate },
  ]

  const modelEntries = Object.entries(today.models)

  return (
    <div className="grid grid-cols-5 gap-2 mb-4">
      {cards.map(card => (
        <div key={card.key} className="bg-bg-secondary rounded-lg p-3 border-l-4" style={{ borderColor: card.color }}>
          <div className="text-xs text-text-muted mb-1">{card.label}</div>
          <div className="text-lg font-semibold" style={{ color: card.color }}>
            {formatNumber(card.value)}
          </div>
        </div>
      ))}

      {/* 今日模型使用次数（分组） */}
      <div className="bg-bg-secondary rounded-lg p-3 border-l-4 border-purple-500">
        <div className="text-xs text-text-muted mb-1">{t('today.models')}</div>
        {modelEntries.length === 0 ? (
          <div className="text-sm text-text-muted">{t('today.noModels')}</div>
        ) : (
          <div className="flex flex-col gap-0.5 max-h-16 overflow-y-auto">
            {modelEntries.map(([model, count]) => (
              <div key={model} className="flex justify-between items-center gap-2 text-xs">
                <span className="text-text-secondary truncate" title={model}>{model}</span>
                <span className="font-semibold text-purple-600">{count}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

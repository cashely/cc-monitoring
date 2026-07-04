import { useTranslation } from 'react-i18next'
import { ArrowDownToLine, ArrowUpFromLine, DatabaseZap, Activity, Boxes } from 'lucide-react'
import { TodayStats } from '../types/stats'
import { TOKEN_COLORS } from './chart-theme'
import { GlowCard } from './GlowCard'

interface Props {
  today: TodayStats
}

const MODEL_COLOR = '#A855F7'

// 大数字千分位格式化
function formatNumber(n: number): string {
  return n.toLocaleString('en-US')
}

export function TodayStatsCards({ today }: Props): JSX.Element {
  const { t } = useTranslation('app')

  const cards = [
    { key: 'input', label: t('today.inputTokens'), value: today.input_tokens, color: TOKEN_COLORS.input, Icon: ArrowDownToLine },
    { key: 'output', label: t('today.outputTokens'), value: today.output_tokens, color: TOKEN_COLORS.output, Icon: ArrowUpFromLine },
    { key: 'cache', label: t('today.cacheTokens'), value: today.cache_read_tokens, color: TOKEN_COLORS.cacheRead, Icon: DatabaseZap },
    { key: 'requests', label: t('today.requestCount'), value: today.request_count, color: TOKEN_COLORS.cacheCreate, Icon: Activity },
  ]

  const modelEntries = Object.entries(today.models)
  const maxCount = Math.max(...modelEntries.map(([, count]) => count), 1)

  return (
    <div className="grid grid-cols-5 gap-2 mb-4">
      {cards.map(card => (
        <GlowCard key={card.key} color={card.color}>
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs text-text-muted">{card.label}</span>
            <card.Icon size={14} style={{ color: card.color }} />
          </div>
          <div className="text-lg font-semibold text-center" style={{ color: card.color }}>
            {formatNumber(card.value)}
          </div>
        </GlowCard>
      ))}

      {/* 今日模型使用次数（横向长方条） */}
      <GlowCard color={MODEL_COLOR}>
        <div className="flex items-center justify-between mb-1">
          <span className="text-xs text-text-muted">{t('today.models')}</span>
          <Boxes size={14} style={{ color: MODEL_COLOR }} />
        </div>
        {modelEntries.length === 0 ? (
          <div className="text-sm text-text-muted">{t('today.noModels')}</div>
        ) : (
          <div className="flex items-end justify-center gap-1.5 h-12">
            {modelEntries.map(([model, count]) => (
              <div key={model} className="flex flex-col items-center justify-end group relative shrink-0 h-full">
                {/* 竖向柱体 */}
                <div
                  className="w-3 rounded-t transition-all duration-300"
                  style={{ height: `${Math.max((count / maxCount) * 100, 8)}%`, backgroundColor: MODEL_COLOR }}
                />
                {/* Tooltip（hover 显示模型名+次数） */}
                <div
                  className="absolute bottom-full mb-1 left-1/2 -translate-x-1/2
                             bg-bg-secondary border border-border rounded px-2 py-1
                             text-xs text-text-primary whitespace-nowrap
                             opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10"
                >
                  {model}: {count}
                </div>
              </div>
            ))}
          </div>
        )}
      </GlowCard>
    </div>
  )
}

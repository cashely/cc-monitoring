import { useState } from 'react'
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts'
import { useTranslation } from 'react-i18next'
import { StatsData, TodayStats, HourlyEntry } from '../types/stats'
import { TodayStatsCards } from './TodayStatsCards'
import { formatTime } from '../utils/format-time'
import { formatCompactNumber } from '../utils/format-number'
import { DARK_CHART_THEME, LIGHT_CHART_THEME, TOKEN_COLORS } from './chart-theme'
import { useTheme } from '../hooks'

type ViewMode = 'hour' | 'day'

const EMPTY_ENTRY: HourlyEntry = {
  input_tokens: 0,
  output_tokens: 0,
  cache_read_tokens: 0,
  cache_creation_tokens: 0,
  request_count: 0,
}

interface StatsBarChartProps {
  stats: StatsData
  todayStats: TodayStats
}

type MetricKey = 'input' | 'output' | 'cache'

const METRICS: { key: MetricKey; nameKey: string; color: string }[] = [
  { key: 'input', nameKey: 'inputTokens', color: TOKEN_COLORS.input },
  { key: 'output', nameKey: 'outputTokens', color: TOKEN_COLORS.output },
  { key: 'cache', nameKey: 'cacheTokens', color: TOKEN_COLORS.cacheRead },
]

export function StatsBarChart({ stats, todayStats }: StatsBarChartProps): JSX.Element {
  const { t } = useTranslation('app')
  const { theme } = useTheme()
  const [viewMode, setViewMode] = useState<ViewMode>('hour')
  const [visibleMetrics, setVisibleMetrics] = useState<Set<MetricKey>>(new Set(METRICS.map(m => m.key)))
  const chartTheme = theme === 'dark' ? DARK_CHART_THEME : LIGHT_CHART_THEME

  const toggleMetric = (key: MetricKey) => {
    setVisibleMetrics(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const generateTimeScale = (mode: ViewMode) => {
    const now = new Date()
    const result = []

    if (mode === 'hour') {
      for (let i = 23; i >= 0; i--) {
        const time = new Date(now)
        time.setHours(now.getHours() - i, 0, 0, 0)

        const utcKey = `${time.getUTCFullYear()}-${String(time.getUTCMonth() + 1).padStart(2, '0')}-${String(time.getUTCDate()).padStart(2, '0')}-${String(time.getUTCHours()).padStart(2, '0')}`
        const display = `${String(time.getHours()).padStart(2, '0')}:00`
        const usage = stats.hourly[utcKey] || EMPTY_ENTRY
        result.push({
          time: display,
          input: usage.input_tokens,
          output: usage.output_tokens,
          cache: usage.cache_read_tokens,
        })
      }
    } else {
      const dailyMap: Record<string, { input: number; output: number; cache: number }> = {}

      for (const [utcKey, entry] of Object.entries(stats.hourly)) {
        const parts = utcKey.split('-')
        const [y, m, d, h] = parts.map(Number)
        if (parts.length !== 4 || parts.some((p) => Number.isNaN(Number(p)))) continue

        const utcMs = Date.UTC(y, m - 1, d, h)
        if (Number.isNaN(utcMs)) continue

        const localDate = new Date(utcMs)
        const localKey = `${localDate.getFullYear()}-${String(localDate.getMonth() + 1).padStart(2, '0')}-${String(localDate.getDate()).padStart(2, '0')}`

        if (!dailyMap[localKey]) {
          dailyMap[localKey] = { input: 0, output: 0, cache: 0 }
        }
        dailyMap[localKey].input += entry.input_tokens
        dailyMap[localKey].output += entry.output_tokens
        dailyMap[localKey].cache += entry.cache_read_tokens
      }

      for (let i = 29; i >= 0; i--) {
        const time = new Date(now)
        time.setDate(now.getDate() - i)
        time.setHours(0, 0, 0, 0)

        const localKey = `${time.getFullYear()}-${String(time.getMonth() + 1).padStart(2, '0')}-${String(time.getDate()).padStart(2, '0')}`
        const display = `${String(time.getMonth() + 1).padStart(2, '0')}-${String(time.getDate()).padStart(2, '0')}`

        const aggregated = dailyMap[localKey] || { input: 0, output: 0, cache: 0 }
        result.push({
          time: display,
          input: aggregated.input,
          output: aggregated.output,
          cache: aggregated.cache,
        })
      }
    }

    return result
  }

  const data = generateTimeScale(viewMode)

  return (
    <div className="glass rounded-xl p-4">
      <TodayStatsCards today={todayStats} />

      <div className="flex justify-end mb-4">
        <div className="flex gap-2">
          <button
            onClick={() => setViewMode('hour')}
            className={`px-3 py-1 text-xs rounded transition-all ${
              viewMode === 'hour'
                ? 'bg-accent text-white'
                : 'bg-bg-secondary text-text-muted hover:bg-bg-hover'
            }`}
          >
            {t('hourly')}
          </button>
          <button
            onClick={() => setViewMode('day')}
            className={`px-3 py-1 text-xs rounded transition-all ${
              viewMode === 'day'
                ? 'bg-accent text-white'
                : 'bg-bg-secondary text-text-muted hover:bg-bg-hover'
            }`}
          >
            {t('daily')}
          </button>
        </div>
      </div>

      <ResponsiveContainer width="100%" height={200} className="text-xs">
        <BarChart data={data} margin={{ top: 10, right: 20, bottom: 5, left: 10 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={chartTheme.gridColor} />
          <XAxis dataKey="time" stroke={chartTheme.axisColor} />
          <YAxis
            stroke={chartTheme.axisTickColor}
            tickFormatter={formatCompactNumber}
            width={50}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: chartTheme.tooltipBg,
              border: `1px solid ${chartTheme.tooltipBorder}`,
              backdropFilter: 'blur(12px)',
              WebkitBackdropFilter: 'blur(12px)',
              borderRadius: '8px',
            }}
            labelStyle={{ color: chartTheme.tooltipText }}
          />
          {METRICS.filter(m => visibleMetrics.has(m.key)).map(m => (
            <Bar key={m.key} dataKey={m.key} fill={m.color} name={t(m.nameKey)} />
          ))}
        </BarChart>
      </ResponsiveContainer>

      {/* 自定义 Legend：点击切换指标 */}
      <div className="flex items-center justify-center gap-4 mt-2">
        {METRICS.map(m => {
          const visible = visibleMetrics.has(m.key)
          return (
            <button
              key={m.key}
              onClick={() => toggleMetric(m.key)}
              className="flex items-center gap-1.5 text-xs transition-all cursor-pointer"
              style={{ opacity: visible ? 1 : 0.4 }}
            >
              <span
                className="inline-block w-3 h-3 rounded-sm"
                style={{
                  backgroundColor: visible ? m.color : '#6B7280',
                  textDecoration: visible ? 'none' : 'line-through',
                }}
              />
              <span style={{ textDecoration: visible ? 'none' : 'line-through', color: visible ? chartTheme.tooltipText : '#6B7280' }}>
                {t(m.nameKey)}
              </span>
            </button>
          )
        })}
      </div>

      <p className="text-xs text-text-muted mt-2">
        {t('lastUpdated')}: {formatTime(stats.lastUpdated)}
      </p>
    </div>
  )
}

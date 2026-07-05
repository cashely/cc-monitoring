import { useState } from 'react'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts'
import { useTranslation } from 'react-i18next'
import { StatsData, TodayStats } from '../types/stats'
import { TodayStatsCards } from './TodayStatsCards'
import { formatTime } from '../utils/format-time'
import { formatCompactNumber } from '../utils/format-number'

type ViewMode = 'hour' | 'day'

interface StatsBarChartProps {
  stats: StatsData
  todayStats: TodayStats
}

export function StatsBarChart({ stats, todayStats }: StatsBarChartProps): JSX.Element {
  const { t } = useTranslation('app')
  const [viewMode, setViewMode] = useState<ViewMode>('hour')

  // Generate fixed time scale and match with stats data
  const generateTimeScale = (mode: ViewMode) => {
    const now = new Date()
    const result = []

    if (mode === 'hour') {
      // Past 24 hours: now backwards
      for (let i = 23; i >= 0; i--) {
        const time = new Date(now)
        time.setHours(now.getHours() - i, 0, 0, 0) // Round to hour start (local time)

        // Use UTC methods for querying backend stats (stored in UTC)
        const utcKey = `${time.getUTCFullYear()}-${String(time.getUTCMonth() + 1).padStart(2, '0')}-${String(time.getUTCDate()).padStart(2, '0')}-${String(time.getUTCHours()).padStart(2, '0')}`

        // Display: "HH:mm" (local time)
        const display = `${String(time.getHours()).padStart(2, '0')}:00`

        const usage = stats.hourly[utcKey] || { input_tokens: 0, output_tokens: 0, cache_read_tokens: 0 }
        result.push({
          time: display,
          input: usage.input_tokens,
          output: usage.output_tokens,
          cache: usage.cache_read_tokens
        })
      }
    } else {
      // Past 30 days: today backwards (using local date for key)
      for (let i = 29; i >= 0; i--) {
        const time = new Date(now)
        time.setDate(now.getDate() - i)
        time.setHours(0, 0, 0, 0) // Round to day start (local time)

        // Key format: "YYYY-MM-DD" (local date)
        const localKey = `${time.getFullYear()}-${String(time.getMonth() + 1).padStart(2, '0')}-${String(time.getDate()).padStart(2, '0')}`

        // Display: "MM-DD" (local time)
        const display = `${String(time.getMonth() + 1).padStart(2, '0')}-${String(time.getDate()).padStart(2, '0')}`

        const usage = stats.daily[localKey] || { input_tokens: 0, output_tokens: 0, cache_read_tokens: 0 }
        result.push({
          time: display,
          input: usage.input_tokens,
          output: usage.output_tokens,
          cache: usage.cache_read_tokens
        })
      }
    }

    return result
  }

  const data = generateTimeScale(viewMode)

  return (
    <div className="bg-bg-card rounded-lg p-4">
      {/* 今日实时统计卡片 */}
      <TodayStatsCards today={todayStats} />

      {/* Toggle buttons */}
      <div className="flex justify-end mb-4">
        <div className="flex gap-2">
          <button
            onClick={() => setViewMode('hour')}
            className={`px-3 py-1 text-xs rounded ${
              viewMode === 'hour'
                ? 'bg-accent text-white'
                : 'bg-bg-secondary text-text-muted hover:bg-bg-hover'
            }`}
          >
            {t('hourly')}
          </button>
          <button
            onClick={() => setViewMode('day')}
            className={`px-3 py-1 text-xs rounded ${
              viewMode === 'day'
                ? 'bg-accent text-white'
                : 'bg-bg-secondary text-text-muted hover:bg-bg-hover'
            }`}
          >
            {t('daily')}
          </button>
        </div>
      </div>

      {/* Bar chart */}
      <ResponsiveContainer width="100%" height={200} className="text-xs">
        <BarChart data={data} margin={{ top: 10, right: 20, bottom: 5, left: 40 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#4a5568" />
          <XAxis dataKey="time" stroke="#718096" />
          <YAxis stroke="#718096" tickFormatter={formatCompactNumber} />
          <Tooltip
            contentStyle={{ backgroundColor: '#2d3748', border: '1px solid #4a5568' }}
            labelStyle={{ color: '#e2e8f0' }}
          />
          <Legend className='text-xs' />
          <Bar dataKey="input" fill="#3b82f6" name={t('inputTokens')} />
          <Bar dataKey="output" fill="#10b981" name={t('outputTokens')} />
          <Bar dataKey="cache" fill="#f59e0b" name={t('cacheTokens')} />
        </BarChart>
      </ResponsiveContainer>

      {/* Last updated timestamp */}
      <p className="text-xs text-text-muted mt-2">
        {t('lastUpdated')}: {formatTime(stats.lastUpdated)}
      </p>
    </div>
  )
}
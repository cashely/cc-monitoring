import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'
import { StatusDataPoint } from '../types/status'
import { DARK_CHART_THEME } from './chart-theme'

interface StatusLineChartProps {
  data: StatusDataPoint[]
  metric: 'cpu' | 'memoryMB'  // CPU 百分比 / 内存 MB
  height?: number             // 默认 120
}

export function StatusLineChart({ data, metric, height = 120 }: StatusLineChartProps): JSX.Element {
  const formatTime = (timestamp: number): string => {
    const date = new Date(timestamp)
    return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
  }

  const isCpu = metric === 'cpu'
  const color = isCpu ? '#3B82F6' : '#10B981'  // Primary蓝 / Success绿
  const yAxisUnit = isCpu ? '%' : 'MB'
  const dataKey = isCpu ? 'cpu' : 'memoryMB'

  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
        <XAxis
          dataKey="timestamp"
          tickFormatter={formatTime}
          stroke={DARK_CHART_THEME.axisColor}
          tick={{ fill: DARK_CHART_THEME.axisTickColor, fontSize: 10 }}
          tickLine={{ stroke: DARK_CHART_THEME.axisColor }}
        />
        <YAxis
          dataKey={dataKey}
          unit={yAxisUnit}
          stroke={DARK_CHART_THEME.axisColor}
          tick={{ fill: DARK_CHART_THEME.axisTickColor, fontSize: 10 }}
          tickLine={{ stroke: DARK_CHART_THEME.axisColor }}
        />
        <Tooltip
          contentStyle={{
            backgroundColor: DARK_CHART_THEME.tooltipBg,
            border: `1px solid ${DARK_CHART_THEME.tooltipBorder}`,
            color: DARK_CHART_THEME.tooltipText,
          }}
          labelFormatter={formatTime}
          formatter={(value: number) => [`${value.toFixed(1)}${yAxisUnit}`, isCpu ? 'CPU' : 'Memory']}
        />
        <Line
          type="monotone"
          dataKey={dataKey}
          stroke={color}
          strokeWidth={2}
          dot={false}
          isAnimationActive={false}  // 禁用入场动画，实现推移效果
        />
      </LineChart>
    </ResponsiveContainer>
  )
}
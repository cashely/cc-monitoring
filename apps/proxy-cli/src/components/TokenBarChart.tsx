import { TokenUsage } from '../types/request'
import { TOKEN_COLORS } from './chart-theme'

interface TokenBarChartProps {
  usage: TokenUsage
}

export function TokenBarChart({ usage }: TokenBarChartProps): JSX.Element {
  const values = {
    input: usage.input_tokens ?? 0,
    output: usage.output_tokens ?? 0,
    cacheRead: usage.cache_read_input_tokens ?? 0,
    cacheCreate: usage.cache_creation_input_tokens ?? 0,
  }

  // 计算最大值作为高度基准
  const maxValue = Math.max(values.input, values.output, values.cacheRead, values.cacheCreate, 1)
  const maxHeight = 16  // 柱子最大高度 16px（跟行高一致）
  const minHeight = 2   // 最小高度 2px

  // 计算每个柱子的高度比例
  const getHeight = (value: number): number => {
    if (value === 0) return minHeight
    return Math.max(minHeight, (value / maxValue) * maxHeight)
  }

  const bars = [
    { key: 'input', label: '输入', value: values.input, color: TOKEN_COLORS.input },
    { key: 'output', label: '输出', value: values.output, color: TOKEN_COLORS.output },
    { key: 'cacheRead', label: '缓存命中', value: values.cacheRead, color: TOKEN_COLORS.cacheRead },
    { key: 'cacheCreate', label: '缓存创建', value: values.cacheCreate, color: TOKEN_COLORS.cacheCreate },
  ]

  return (
    <div className="flex items-end gap-1 ml-2">
      {bars.map(bar => (
        <div key={bar.key} className="flex flex-col items-center group relative">
          {/* 柱体 */}
          <div
            className="w-3 rounded-t transition-all duration-300"
            style={{
              height: `${getHeight(bar.value)}px`,
              backgroundColor: bar.color,
            }}
          />

          {/* Tooltip（hover 显示） */}
          <div
            className="absolute bottom-full mb-1 left-1/2 -translate-x-1/2
                       bg-bg-secondary border border-border rounded px-2 py-1
                       text-xs text-text-primary whitespace-nowrap
                       opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10"
          >
            {bar.label}: {bar.value}
          </div>
        </div>
      ))}
    </div>
  )
}
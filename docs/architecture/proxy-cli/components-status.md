# proxy-cli / 状态类组件

## 本文档覆盖的源文件

- `apps/proxy-cli/src/components/StatusPanel.tsx`
- `apps/proxy-cli/src/components/StatusLineChart.tsx`
- `apps/proxy-cli/src/components/ConnectionBanner.tsx`
- `apps/proxy-cli/src/components/chart-theme.ts`

## StatusPanel

`apps/proxy-cli/src/components/StatusPanel.tsx:9-44`。**当前实现只显示两张折线图**（CPU + Memory），文字状态信息（online/stopped/uptime/restarts）已不展示——面板右上角靠 `ConnectionBanner` 反映连接性。

```tsx
export function StatusPanel({ status }: { status: StatusApiResponse & { history?: StatusDataPoint[] } }): JSX.Element {
  const history = status.history || []
  const memoryHistory = history.map(p => ({ ...p, memoryMB: p.memory / 1024 / 1024 }))

  return (
    <div className="text-sm">
      <div className="mb-2">
        <h4>{t('cpuChart')}</h4>
        <StatusLineChart data={history} metric="cpu" height={120} />
      </div>
      <div>
        <h4>{t('memoryChart')}</h4>
        <StatusLineChart data={memoryHistory} metric="memoryMB" height={120} />
      </div>
    </div>
  )
}
```

- 内存 bytes → MB 在组件里现算（`p.memory / 1024 / 1024`），加字段 `memoryMB`
- 两张图共用同一 `history` 数组
- 高度都固定 120px
- `statusColorMap` 定义但未使用（`StatusPanel.tsx:22-27`）——遗留

## StatusLineChart

`apps/proxy-cli/src/components/StatusLineChart.tsx`。基于 Recharts：

```tsx
interface Props {
  data: StatusDataPoint[]
  metric: 'cpu' | 'memoryMB'
  height?: number   // 默认 120
}
```

关键配置：

- `dataKey='timestamp'` X 轴（Unix ms），`tickFormatter = formatTime(ts, 'time')` 显示 HH:mm（本地时区）
- `dataKey = 'cpu' | 'memoryMB'` Y 轴
- `unit`：`%` 或 `MB`
- `color`：CPU 蓝 `#3B82F6`，Memory 绿 `#10B981`
- `Tooltip formatter`：`${value.toFixed(1)}${unit}`
- `Line`：`type='monotone'`，`strokeWidth={2}`，`dot={false}`（点太密）
- **`isAnimationActive={false}`**：禁用动画。10s 采样一次，动画反而让"推移"视觉断裂——去掉后新数据从右侧滑入更自然

`ResponsiveContainer` 让高度固定、宽度撑满父。

## chart-theme

`apps/proxy-cli/src/components/chart-theme.ts`。两个常量：

```ts
export const DARK_CHART_THEME = {
  axisColor: '#94A3B8',
  axisTickColor: '#94A3B8',
  gridColor: '#475569',
  tooltipBg: '#111827',
  tooltipBorder: '#475569',
  tooltipText: '#F8FAFC'
} as const

export const TOKEN_COLORS = {
  input: '#3B82F6',        // 蓝 - Primary
  output: '#10B981',       // 绿 - Success
  cacheRead: '#F59E0B',    // 橙 - Warning
  cacheCreate: '#06B6D4'   // 青蓝 - Info
} as const
```

被 `StatusLineChart / StatsBarChart / TodayStatsCards / TokenBarChart / ConfigEditor / GlowCard` 复用。改整站色板改这里。

## ConnectionBanner

`apps/proxy-cli/src/components/ConnectionBanner.tsx`：

```tsx
export function ConnectionBanner({ connected }: { connected: boolean }) {
  if (connected) return null
  return (
    <div className="bg-red-500 text-white px-4 py-2 text-center font-medium fixed top-0 left-0 right-0 z-50">
      {t('connection.disconnected')}
    </div>
  )
}
```

- 极简：仅在 `connected === false` 时显示
- `fixed top-0 z-50` 全屏顶部覆盖
- 文案来自 `app:connection.disconnected` 命名空间
- **传入的 `connected` 语义**：`App.tsx` 传 `connectionState !== 'disconnected'`，即 `connecting / connected` 都算「连着」，只有明确 `disconnected` 才显红条

## 相关

- 数据来源 → [data-hooks.md](./data-hooks.md#usewebsocketdata--主数据通道)
- 后端采样 → [../proxy-core/stats-and-history.md](../proxy-core/stats-and-history.md#内存态statushistorystore)

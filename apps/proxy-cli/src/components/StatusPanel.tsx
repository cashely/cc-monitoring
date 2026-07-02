import { useTranslation } from 'react-i18next'
import { StatusLineChart } from './StatusLineChart'
import { StatusApiResponse, StatusDataPoint } from '../types'

interface StatusPanelProps {
  status: StatusApiResponse & { history?: StatusDataPoint[] }
}

export function StatusPanel({ status }: StatusPanelProps): JSX.Element {
  const { t } = useTranslation('status')

  // Extract history from status (or empty array if not provided)
  const history = status.history || []

  // Memory 历史数据需要 bytes -> MB 转换
  const memoryHistory = history.map(p => ({
    ...p,
    memoryMB: p.memory / 1024 / 1024
  }))

  // 状态颜色映射
  const statusColorMap: Record<string, string> = {
    online: 'bg-success',
    stopped: 'bg-error',
    errored: 'bg-error',
    launching: 'bg-warning',
  }

  return (
    <div className="text-sm">
      {/* CPU 折线图 */}
      <div className="mb-2">
        <h4 className="text-xs text-text-muted mb-1">{t('cpuChart')}</h4>
        <StatusLineChart data={history} metric="cpu" height={120} />
      </div>

      {/* Memory 折线图 */}
      <div>
        <h4 className="text-xs text-text-muted mb-1">{t('memoryChart')}</h4>
        <StatusLineChart data={memoryHistory} metric="memoryMB" height={120} />
      </div>
    </div>
  )
}

import { TokenUsage } from '../types/request'
import { TokenBarChart } from './TokenBarChart'

interface TokenMetricsCellProps {
  usage?: TokenUsage
}

export function TokenMetricsCell({ usage }: TokenMetricsCellProps): JSX.Element {
  if (!usage) {
    return <span className="text-text-muted text-xs">--</span>
  }

  return (
    <div className="flex items-center">
      <TokenBarChart usage={usage} />
    </div>
  )
}

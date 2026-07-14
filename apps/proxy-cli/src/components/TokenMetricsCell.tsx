import { TokenUsage } from '../types/request'
import { TokenBarChart } from './TokenBarChart'

interface TokenMetricsCellProps {
  usage?: TokenUsage
}

export function TokenMetricsCell({ usage }: TokenMetricsCellProps): JSX.Element {
  if (!usage || (!usage.input_tokens && !usage.output_tokens && !usage.cache_read_input_tokens && !usage.cache_creation_input_tokens)) {
    return <span className="text-text-muted text-xs">--</span>
  }

  return <TokenBarChart usage={usage} />
}

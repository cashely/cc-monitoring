interface Props {
  method: string
  /** HTTP 状态码：传入时按成败着色（2xx 绿、非 2xx 红），覆盖方法默认色 */
  statusCode?: number
}

const METHOD_COLORS: Record<string, string> = {
  GET: 'bg-emerald-500/20 text-emerald-600 border-emerald-500/30',
  POST: 'bg-blue-500/20 text-blue-600 border-blue-500/30',
  PUT: 'bg-amber-500/20 text-amber-600 border-amber-500/30',
  PATCH: 'bg-amber-500/20 text-amber-600 border-amber-500/30',
  DELETE: 'bg-red-500/20 text-red-600 border-red-500/30',
  HEAD: 'bg-gray-500/20 text-gray-600 border-gray-500/30',
  OPTIONS: 'bg-gray-500/20 text-gray-600 border-gray-500/30',
}

const SUCCESS_COLOR = 'bg-emerald-500/20 text-emerald-600 border-emerald-500/30'
const ERROR_COLOR = 'bg-red-500/20 text-red-600 border-red-500/30'

export function MethodTag({ method, statusCode }: Props): JSX.Element {
  const colorClass =
    statusCode !== undefined
      ? statusCode >= 200 && statusCode < 300
        ? SUCCESS_COLOR
        : ERROR_COLOR
      : METHOD_COLORS[method.toUpperCase()] ?? METHOD_COLORS.HEAD

  return (
    <span
      className={`px-2 py-0.5 text-xs font-semibold rounded border ${colorClass}`}
    >
      {method.toUpperCase()}
    </span>
  )
}
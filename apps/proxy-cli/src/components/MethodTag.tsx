interface Props {
  method: string
  /** HTTP 状态码：传入时按成败着色（2xx 绿、非 2xx 红），覆盖方法默认色 */
  statusCode?: number
}

const METHOD_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  GET: { bg: 'rgba(16, 185, 129, 0.2)', text: '#10B981', border: 'rgba(16, 185, 129, 0.3)' },
  POST: { bg: 'rgba(59, 130, 246, 0.2)', text: '#3B82F6', border: 'rgba(59, 130, 246, 0.3)' },
  PUT: { bg: 'rgba(245, 158, 11, 0.2)', text: '#F59E0B', border: 'rgba(245, 158, 11, 0.3)' },
  PATCH: { bg: 'rgba(245, 158, 11, 0.2)', text: '#F59E0B', border: 'rgba(245, 158, 11, 0.3)' },
  DELETE: { bg: 'rgba(239, 68, 68, 0.2)', text: '#EF4444', border: 'rgba(239, 68, 68, 0.3)' },
  HEAD: { bg: 'rgba(148, 163, 184, 0.2)', text: '#94A3B8', border: 'rgba(148, 163, 184, 0.3)' },
  OPTIONS: { bg: 'rgba(148, 163, 184, 0.2)', text: '#94A3B8', border: 'rgba(148, 163, 184, 0.3)' },
}

const SUCCESS_COLOR = { bg: 'rgba(16, 185, 129, 0.2)', text: '#10B981', border: 'rgba(16, 185, 129, 0.3)' }
const ERROR_COLOR = { bg: 'rgba(239, 68, 68, 0.2)', text: '#EF4444', border: 'rgba(239, 68, 68, 0.3)' }

export function MethodTag({ method, statusCode }: Props): JSX.Element {
  const colors =
    statusCode !== undefined
      ? statusCode >= 200 && statusCode < 300
        ? SUCCESS_COLOR
        : ERROR_COLOR
      : METHOD_COLORS[method.toUpperCase()] ?? METHOD_COLORS.HEAD

  return (
    <span
      className="px-2 py-0.5 text-xs font-semibold rounded border"
      style={{
        backgroundColor: colors.bg,
        color: colors.text,
        borderColor: colors.border,
      }}
    >
      {method.toUpperCase()}
    </span>
  )
}

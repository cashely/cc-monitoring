interface Props {
  method: string
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

export function MethodTag({ method }: Props): JSX.Element {
  const colorClass = METHOD_COLORS[method.toUpperCase()] ?? METHOD_COLORS.HEAD

  return (
    <span
      className={`px-2 py-0.5 text-xs font-semibold rounded border ${colorClass}`}
    >
      {method.toUpperCase()}
    </span>
  )
}
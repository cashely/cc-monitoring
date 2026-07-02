interface Props {
  model: string
}

export function ModelTag({ model }: Props): JSX.Element {
  return (
    <span className="px-2 py-0.5 text-xs font-semibold rounded border bg-purple-500/20 text-purple-600 border-purple-500/30">
      {model}
    </span>
  )
}

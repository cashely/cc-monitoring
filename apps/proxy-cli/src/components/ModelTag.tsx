interface Props {
  model: string
}

export function ModelTag({ model }: Props): JSX.Element {
  return (
    <span
      className="px-2 py-0.5 text-xs font-semibold rounded border"
      style={{
        backgroundColor: 'rgba(168, 85, 247, 0.2)',
        color: '#A855F7',
        borderColor: 'rgba(168, 85, 247, 0.3)',
      }}
    >
      {model}
    </span>
  )
}

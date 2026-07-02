import { useEffect, useState } from 'react'
import { codeToHtml } from 'shiki'

interface Props {
  code: string
  lang: 'json' | 'markdown'
  theme?: string
}

export function ShikiHighlighter({ code, lang, theme = 'github-dark' }: Props) {
  const [html, setHtml] = useState('')

  useEffect(() => {
    codeToHtml(code, { lang, theme }).then(setHtml)
  }, [code, lang, theme])

  return (
    <div
      className="max-h-[400px] overflow-y-auto bg-bg-primary rounded p-3 text-sm my-2 [&_pre]:m-0 [&_pre]:p-0 [&_pre]:bg-transparent"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}
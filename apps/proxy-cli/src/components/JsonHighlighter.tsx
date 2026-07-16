import hljs from 'highlight.js/lib/core'
import json from 'highlight.js/lib/languages/json'
import 'highlight.js/styles/github-dark.css'
import { useState } from 'react'
import { Copy, Check } from 'lucide-react'

hljs.registerLanguage('json', json)

interface Props {
  code: string
  lang?: 'json' | 'markdown'
}

export function JsonHighlighter({ code, lang = 'json' }: Props) {
  const [copied, setCopied] = useState(false)
  const highlighted = hljs.highlight(code, { language: lang }).value

  const handleCopy = async () => {
    await navigator.clipboard.writeText(code)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div
      className="group relative max-h-[400px] overflow-auto hljs rounded p-3 text-sm my-2"
    >
      <button
        onClick={handleCopy}
        className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity bg-bg-hover/80 text-text-muted p-1 rounded border border-border z-10"
        title="复制"
      >
        {copied ? <Check size={12} /> : <Copy size={12} />}
      </button>
      <pre className="m-0 p-0 bg-transparent whitespace-pre">
        <code className={`language-${lang}`} dangerouslySetInnerHTML={{ __html: highlighted }} />
      </pre>
    </div>
  )
}

import hljs from 'highlight.js/lib/core'
import json from 'highlight.js/lib/languages/json'
import 'highlight.js/styles/github-dark.css'

hljs.registerLanguage('json', json)

interface Props {
  code: string
  lang?: 'json' | 'markdown'
}

export function JsonHighlighter({ code, lang = 'json' }: Props) {
  const highlighted = hljs.highlight(code, { language: lang }).value

  return (
    <div
      className="max-h-[400px] overflow-auto hljs rounded p-3 text-sm my-2"
    >
      <pre className="m-0 p-0 bg-transparent whitespace-pre">
        <code className={`language-${lang}`} dangerouslySetInnerHTML={{ __html: highlighted }} />
      </pre>
    </div>
  )
}

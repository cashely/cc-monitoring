import { parseEvents } from '../utils/parse-events'
import { ShikiHighlighter } from './ShikiHighlighter'

interface Props {
  events: any[]
}

export function ParsedResponseBlocks({ events }: Props): JSX.Element {
  const parsed = parseEvents(events)

  return (
    <div className="space-y-3">
      {/* Thinking块 */}
      {parsed.thinking && (
        <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded p-3">
          <h3 className="text-sm font-semibold text-blue-800 dark:text-blue-300 mb-2">
            🤔 AI 思考过程
          </h3>
          <p className="text-blue-900 dark:text-blue-100 whitespace-pre-wrap">
            {parsed.thinking}
          </p>
        </div>
      )}

      {/* Text块 */}
      {parsed.text && (
        <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded p-3">
          <h3 className="text-sm font-semibold text-green-800 dark:text-green-300 mb-2">
            💬 AI 回复内容
          </h3>
          <p className="text-green-900 dark:text-green-100 whitespace-pre-wrap">
            {parsed.text}
          </p>
        </div>
      )}

      {/* Tool Calls块 */}
      {parsed.toolCalls && parsed.toolCalls.length > 0 && (
        <div className="bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-800 rounded p-3">
          <h3 className="text-sm font-semibold text-purple-800 dark:text-purple-300 mb-2">
            🔧 工具调用 ({parsed.toolCalls.length})
          </h3>
          {parsed.toolCalls.map((tool, i) => (
            <div key={i} className="mb-2 last:mb-0">
              <div className="text-purple-700 dark:text-purple-400 font-medium mb-1">
                {tool.name} <span className="text-xs opacity-60">({tool.id})</span>
              </div>
              <ShikiHighlighter
                code={JSON.stringify(tool.input, null, 2)}
                lang="json"
              />
            </div>
          ))}
        </div>
      )}

      </div>
  )
}
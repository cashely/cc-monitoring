import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { RequestSummary, RequestDetails, TokenUsage } from '../types/request'
import { ShikiHighlighter } from './ShikiHighlighter'
import { Tabs } from './Tabs'
import { TokenBarChart } from './TokenBarChart'
import { MethodTag } from './MethodTag'
import { ModelTag } from './ModelTag'
import { ParsedResponseBlocks } from './ParsedResponseBlocks'
import { useInViewControl } from '../hooks/useInViewControl'

interface Props {
  summary: RequestSummary
  isExpanded?: boolean
  onExpand?: () => void
  onCollapse?: () => void
  isSelected?: boolean
  onToggleSelect?: (id: string) => void
}

export function RequestCard({
  summary,
  isExpanded = false,
  onExpand,
  onCollapse,
  isSelected = false,
  onToggleSelect,
}: Props): JSX.Element {
  const [details, setDetails] = useState<RequestDetails | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { t } = useTranslation('app')
  const { ref: detailRef, inView } = useInViewControl()

  async function handleExpand(): Promise<void> {
    if (isExpanded) {
      onCollapse?.()
      setError(null)
      return
    }

    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/ui/api/requests/${summary.compositeId}`)
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${res.statusText}`)
      }
      const data: RequestDetails = await res.json()
      setDetails(data)
      onExpand?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败')
      onExpand?.() // 展开显示错误
    } finally {
      setLoading(false)
    }
  }

  const formatTime = (timestamp: string): string => {
    const date = new Date(timestamp)
    return date.toLocaleString('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    })
  }

  // 响应耗时以秒为单位，保留 1 位小数（如 1.2s、0.1s）
  const formatDuration = (ms: number): string => `${(ms / 1000).toFixed(1)}s`

  return (
    <div data-testid="request-card" className="border border-border rounded-lg bg-bg-primary">
      <div
        className="p-3 cursor-pointer hover:bg-bg-hover transition-colors"
        onClick={handleExpand}
      >
        <div className="flex justify-between items-center gap-2">
          <span className="font-medium flex-1 flex items-center gap-2 text-sm">
            {onToggleSelect && (
              <input
                type="checkbox"
                checked={isSelected}
                onClick={(e) => e.stopPropagation()}
                onChange={() => onToggleSelect(summary.compositeId)}
                className="cursor-pointer"
                aria-label={t('requests.compare')}
              />
            )}
            <span className="text-text-muted">[{formatTime(summary.timestamp)}]</span>
            <MethodTag method={summary.method} statusCode={summary.statusCode} />
            <span>{summary.path}</span>
          </span>

          {/* Token 柱状图（在 URL 右侧） */}
          {(summary.usage || details?.response?.usage) && (
            <TokenBarChart usage={(summary.usage ?? details?.response?.usage)!} />
          )}

          <span className="text-xs text-text-muted ml-4 flex items-center gap-2">
            <span>{formatDuration(summary.responseTime)}</span>
            {summary.model && <ModelTag model={summary.model} />}
          </span>
          <button
            aria-label={isExpanded ? 'collapse' : 'expand'}
            onClick={(e) => {
              e.stopPropagation()
              handleExpand()
            }}
            className="text-text-muted hover:text-text-primary transition-colors ml-2"
          >
            {isExpanded ? '▾' : '▸'}
          </button>
        </div>
      </div>

      {isExpanded && error && (
        <div className="p-3 border-t border-border bg-error/10 text-error rounded-lg">
          <div className="flex justify-between items-center">
            <span>加载失败: {error}</span>
            <button
              onClick={handleExpand}
              className="text-sm px-2 py-1 bg-error/20 hover:bg-error/30 rounded"
            >
              重试
            </button>
          </div>
        </div>
      )}

      {isExpanded && details && (
        <div ref={detailRef} className="p-3 border-t border-border">
          {inView ? (
            <Tabs
              tabs={[
                { id: 'reqHeaders', label: '请求 Headers' },
                { id: 'reqBody', label: '请求 Body' },
                { id: 'resHeaders', label: '响应 Headers' },
                { id: 'resBody', label: '响应 Body' },
              ]}
              defaultTab="reqHeaders"
              children={{
                reqHeaders: details.request.headers ? (
                  <ShikiHighlighter
                    code={JSON.stringify(details.request.headers, null, 2)}
                    lang="json"
                  />
                ) : (
                  <span className="text-text-muted">无数据</span>
                ),
                reqBody: details.request.body ? (
                  <ShikiHighlighter
                    code={JSON.stringify(details.request.body, null, 2)}
                    lang="json"
                  />
                ) : (
                  <span className="text-text-muted">无数据</span>
                ),
                resHeaders: details.response?.headers ? (
                  <ShikiHighlighter
                    code={JSON.stringify(details.response.headers, null, 2)}
                    lang="json"
                  />
                ) : (
                  <span className="text-text-muted">无数据</span>
                ),
                resBody:
                  details.response?.events && details.response.events.length > 0 ? (
                    <div className="max-h-[600px] overflow-y-auto">
                      <ParsedResponseBlocks events={details.response.events} />
                      <div className="mt-4 border-t border-border pt-2">
                        <h3 className="text-sm font-semibold mb-2">原始 Events</h3>
                        {details.response.events.map((event, i) => (
                          <div key={i} className="my-2 border-b border-border">
                            <span className="text-text-muted text-xs block mb-1">
                              #{i + 1} {event.type ?? 'unknown'}
                            </span>
                            <ShikiHighlighter
                              code={JSON.stringify(event, null, 2)}
                              lang="json"
                            />
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : details.response?.error ? (
                    <div className="bg-error/10 p-2 rounded text-error">
                      {details.response.error}
                    </div>
                  ) : (
                    <span className="text-text-muted">无数据</span>
                  ),
              }}
            />
          ) : (
            <div className="text-text-muted text-center py-8">
              滚动到此处显示详情...
            </div>
          )}
        </div>
      )}

      {loading && (
        <div className="p-3 border-t border-border text-text-muted">
          Loading...
        </div>
      )}
    </div>
  )
}
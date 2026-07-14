import { useState, useEffect } from 'react'
import { Button } from 'antd'
import { CloseOutlined } from '@ant-design/icons'
import { useTranslation } from 'react-i18next'
import { RequestDetails } from '../types/request'
import { Tabs } from './Tabs'
import { ShikiHighlighter } from './ShikiHighlighter'
import { ParsedResponseBlocks } from './ParsedResponseBlocks'

interface RequestDetailModalProps {
  compositeId: string
  onClose: () => void
}

export function RequestDetailModal({
  compositeId,
  onClose,
}: RequestDetailModalProps): JSX.Element {
  const { t } = useTranslation('app')
  const [details, setDetails] = useState<RequestDetails | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function loadDetails() {
      setLoading(true)
      setError(null)
      try {
        const res = await fetch(`/ui/api/requests/${compositeId}`)
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}: ${res.statusText}`)
        }
        const data: RequestDetails = await res.json()
        setDetails(data)
      } catch (err) {
        setError(err instanceof Error ? err.message : '加载失败')
      } finally {
        setLoading(false)
      }
    }
    loadDetails()
  }, [compositeId])

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose()
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={handleBackdropClick}
    >
      <div
        className="bg-bg-primary rounded-lg max-w-5xl w-[90vw] max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex justify-between items-center p-4 border-b border-border">
          <h2 className="text-base font-semibold">{t('requests.detailTitle') || '请求详情'}</h2>
          <Button
            type="text"
            icon={<CloseOutlined />}
            onClick={onClose}
          />
        </header>

        {loading && (
          <div className="p-8 text-center text-text-muted">
            {t('requests.loading') || 'Loading...'}
          </div>
        )}

        {error && (
          <div className="p-4 bg-error/10 text-error m-4 rounded">
            加载失败: {error}
          </div>
        )}

        {!loading && !error && details && (
          <div className="flex-1 overflow-auto p-4">
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
                resBody: details.response?.events && details.response.events.length > 0 ? (
                  <div className="max-h-[500px] overflow-y-auto">
                    <ParsedResponseBlocks events={details.response.events} />
                    <details className="mt-4 border-t border-border pt-2">
                      <summary className="text-xs font-semibold mb-2 cursor-pointer select-none">
                        原始 Events ({details.response.events.length})
                      </summary>
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
                    </details>
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
          </div>
        )}
      </div>
    </div>
  )
}

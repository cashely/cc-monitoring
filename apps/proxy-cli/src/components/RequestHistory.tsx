import { useState } from 'react'
import { RequestSummary } from '../types/request'
import { RequestCard } from './RequestCard'
import { RequestCompareModal } from './RequestCompareModal'
import { useTranslation } from 'react-i18next'
import { GitCompareArrows, ChevronRight } from 'lucide-react'

interface RequestHistoryProps {
  requests: RequestSummary[]
  loading?: boolean
}

export function RequestHistory({ requests, loading }: RequestHistoryProps): JSX.Element {
  const { t } = useTranslation('app')
  const [expandedCardId, setExpandedCardId] = useState<string | null>(null)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [compareOpen, setCompareOpen] = useState(false)
  const [expandedSessions, setExpandedSessions] = useState<Set<string>>(new Set())

  if (loading) {
    return (
      <div className="text-text-muted text-center py-8 animate-pulse">
        {t('requests.loading')}
      </div>
    )
  }

  if (requests.length === 0) {
    return (
      <div className="text-text-muted text-center py-8">
        {t('requests.empty')}
      </div>
    )
  }

  const handleCardExpand = (compositeId: string) => {
    setExpandedCardId(compositeId)
  }

  const handleCardCollapse = () => {
    setExpandedCardId(null)
  }

  const handleToggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id)
      if (prev.length >= 2) return [prev[1], id] // FIFO: evict earliest
      return [...prev, id]
    })
  }

  const handleCompareClick = () => {
    if (selectedIds.length === 2) {
      setCompareOpen(true)
    }
  }

  const handleCloseModal = () => {
    setCompareOpen(false)
    setSelectedIds([])
  }

  const handleToggleSession = (sessionId: string) => {
    setExpandedSessions((prev) => {
      const next = new Set(prev)
      if (next.has(sessionId)) next.delete(sessionId)
      else next.add(sessionId)
      return next
    })
  }

  // 按 sessionId 保序分组：requests 已是全局时间倒序，保序分组后
  // 组内保持时间倒序，最新活跃的 session 组自然排在最前
  const sessionGroups: { sessionId: string; items: RequestSummary[] }[] = []
  const groupIndex = new Map<string, number>()
  for (const summary of requests) {
    const idx = groupIndex.get(summary.sessionId)
    if (idx === undefined) {
      groupIndex.set(summary.sessionId, sessionGroups.length)
      sessionGroups.push({ sessionId: summary.sessionId, items: [summary] })
    } else {
      sessionGroups[idx].items.push(summary)
    }
  }

  return (
    <div className="overflow-y-auto" style={{ height: '100%' }}>
      <div className="sticky top-0 z-10 pb-4 pr-2 flex justify-end">
        <button
          onClick={handleCompareClick}
          disabled={selectedIds.length !== 2}
          title={t('requests.compare')}
          className="flex items-center p-1.5 rounded bg-primary text-white disabled:opacity-40 disabled:cursor-not-allowed hover:bg-primary/90 transition-colors"
        >
          <GitCompareArrows size={16} />
        </button>
      </div>

      <div className="flex flex-col gap-4 px-2 pb-2">
        {sessionGroups.map((group) => {
          const isSessionExpanded = expandedSessions.has(group.sessionId)
          return (
            <div key={group.sessionId} className="flex flex-col gap-2">
              <div className="flex items-center gap-2 text-xs text-text-muted select-none">
                <span className="flex-1 border-t border-border" />
                <span className="font-mono truncate max-w-[60%]" title={group.sessionId}>
                  {group.sessionId}
                </span>
                <button
                  onClick={() => handleToggleSession(group.sessionId)}
                  title={group.sessionId}
                  data-testid={`session-toggle-${group.sessionId}`}
                  className="shrink-0 flex items-center gap-1 px-1.5 py-0.5 rounded bg-bg-hover text-[10px] hover:text-text-primary transition-colors cursor-pointer"
                >
                  <ChevronRight
                    size={12}
                    className={`transition-transform ${isSessionExpanded ? 'rotate-90' : ''}`}
                  />
                  {group.items.length}
                </button>
                <span className="flex-1 border-t border-border" />
              </div>
              {isSessionExpanded &&
                group.items.map((summary) => {
                  const isExpanded = summary.compositeId === expandedCardId
                  return (
                    <RequestCard
                      key={summary.compositeId}
                      summary={summary}
                      isExpanded={isExpanded}
                      onExpand={() => handleCardExpand(summary.compositeId)}
                      onCollapse={() => handleCardCollapse()}
                      isSelected={selectedIds.includes(summary.compositeId)}
                      onToggleSelect={handleToggleSelect}
                    />
                  )
                })}
            </div>
          )
        })}
      </div>

      {compareOpen && selectedIds.length === 2 && (
        <RequestCompareModal
          leftId={selectedIds[0]}
          rightId={selectedIds[1]}
          onClose={handleCloseModal}
        />
      )}
    </div>
  )
}

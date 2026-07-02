import { useState } from 'react'
import { RequestSummary } from '../types/request'
import { RequestCard } from './RequestCard'
import { RequestCompareModal } from './RequestCompareModal'
import { useTranslation } from 'react-i18next'

interface RequestHistoryProps {
  requests: RequestSummary[]
  loading?: boolean
}

export function RequestHistory({ requests, loading }: RequestHistoryProps): JSX.Element {
  const { t } = useTranslation('app')
  const [expandedCardId, setExpandedCardId] = useState<string | null>(null)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [compareOpen, setCompareOpen] = useState(false)

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

  return (
    <div className="overflow-y-auto" style={{ height: '100%' }}>
      <div className="sticky top-0 z-10 pb-4 pr-2 flex justify-end">
        <button
          onClick={handleCompareClick}
          disabled={selectedIds.length !== 2}
          className="px-3 py-1 text-sm rounded bg-primary text-white disabled:opacity-40 disabled:cursor-not-allowed hover:bg-primary/90 transition-colors"
        >
          {t('requests.compare')}
        </button>
      </div>

      <div className="flex flex-col gap-2 px-2 pb-2">
        {requests.map((summary) => {
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

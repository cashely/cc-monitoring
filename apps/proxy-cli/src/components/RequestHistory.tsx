import { useState, useMemo } from 'react'
import { RequestSummary } from '../types/request'
import { RequestTable } from './RequestTable'
import { RequestDetailModal } from './RequestDetailModal'
import { RequestCompareModal } from './RequestCompareModal'
import { useTranslation } from 'react-i18next'

interface RequestHistoryProps {
  requests: RequestSummary[]
  loading?: boolean
}

export function RequestHistory({ requests, loading }: RequestHistoryProps): JSX.Element {
  const { t } = useTranslation('app')
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [detailId, setDetailId] = useState<string | null>(null)
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

  const handleCompare = (ids: string[]) => {
    setSelectedIds(ids)
    setCompareOpen(true)
  }

  const handleRowClick = (request: RequestSummary) => {
    setDetailId(request.compositeId)
  }

  const handleCloseModal = () => {
    setCompareOpen(false)
    setSelectedIds([])
  }

  const handleCloseDetail = () => {
    setDetailId(null)
  }

  return (
    <div className="h-full">
      <RequestTable
        initialRequests={requests}
        onCompare={handleCompare}
        onRowClick={handleRowClick}
        loading={loading}
      />

      {detailId && (
        <RequestDetailModal
          compositeId={detailId}
          onClose={handleCloseDetail}
        />
      )}

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

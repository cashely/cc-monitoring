import { useState, useCallback } from 'react'
import { Table, TableProps, Button, Checkbox } from 'antd'
import { GitCompareArrows } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { RequestSummary } from '../types/request'
import { MethodTag } from './MethodTag'
import { ModelTag } from './ModelTag'
import { TokenMetricsCell } from './TokenMetricsCell'
import { formatTime } from '../utils/format-time'
import { fetchRequests } from '../api'

interface RequestTableProps {
  initialRequests: RequestSummary[]
  onCompare: (selectedIds: string[]) => void
  onRowClick: (request: RequestSummary) => void
  loading?: boolean
}

const PAGE_SIZE = 100

function truncateSessionId(sessionId: string, length: number): string {
  return sessionId.length > length ? `${sessionId.slice(0, length)}...` : sessionId
}

export function RequestTable({
  initialRequests,
  onCompare,
  onRowClick,
  loading: externalLoading,
}: RequestTableProps): JSX.Element {
  const { t } = useTranslation('app')
  const [allRequests, setAllRequests] = useState<RequestSummary[]>(initialRequests)
  const [displayedCount, setDisplayedCount] = useState(PAGE_SIZE)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(true)
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([])

  // 合并新请求
  useState(() => {
    setAllRequests(prev => {
      const existingIds = new Set(prev.map(r => r.compositeId))
      const newRequests = initialRequests.filter(r => !existingIds.has(r.compositeId))
      if (newRequests.length === 0) return prev
      return [...newRequests, ...prev]
    })
  }, [initialRequests])

  const displayedRequests = allRequests.slice(0, displayedCount)

  const handleLoadMore = useCallback(async () => {
    if (loadingMore || !hasMore) return

    setLoadingMore(true)
    try {
      const oldestRequest = allRequests[allRequests.length - 1]
      const before = oldestRequest?.timestamp

      const result = await fetchRequests(PAGE_SIZE, before)

      if (result.requests.length > 0) {
        setAllRequests(prev => {
          const existingIds = new Set(prev.map(r => r.compositeId))
          const filteredNew = result.requests.filter(r => !existingIds.has(r.compositeId))
          return [...prev, ...filteredNew]
        })
        setDisplayedCount(prev => prev + result.requests.length)
      }
      setHasMore(result.hasMore)
    } finally {
      setLoadingMore(false)
    }
  }, [loadingMore, hasMore, allRequests])

  const columns: TableProps<RequestSummary>['columns'] = [
    {
      title: '',
      key: 'checkbox',
      width: 48,
      render: (_, record) => (
        <Checkbox
          checked={selectedRowKeys.includes(record.compositeId)}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => {
            setSelectedRowKeys(prev => {
              if (e.target.checked) {
                const newSelected = [...prev, record.compositeId]
                return newSelected.slice(-2)
              } else {
                return prev.filter(k => k !== record.compositeId)
              }
            })
          }}
        />
      ),
    },
    {
      title: '时间',
      dataIndex: 'timestamp',
      key: 'timestamp',
      width: 160,
      render: (value: string) => (
        <span className="text-sm text-text-muted">
          {formatTime(value, 'monthDayTime')}
        </span>
      ),
    },
    {
      title: 'Method',
      dataIndex: 'method',
      key: 'method',
      width: 100,
      render: (_: any, record: RequestSummary) => (
        <MethodTag
          method={record.method}
          statusCode={record.statusCode}
        />
      ),
    },
    {
      title: 'URL',
      dataIndex: 'path',
      key: 'path',
      ellipsis: true,
      render: (value: string) => <span className="text-sm">{value}</span>,
    },
    {
      title: '耗时',
      dataIndex: 'responseTime',
      key: 'responseTime',
      width: 80,
      render: (value: number) => (
        <span className="text-xs text-text-muted">
          {(value / 1000).toFixed(1)}s
        </span>
      ),
    },
    {
      title: '模型',
      dataIndex: 'model',
      key: 'model',
      width: 120,
      render: (value: string) => value ? <ModelTag model={value} /> : null,
    },
    {
      title: 'Session ID',
      dataIndex: 'sessionId',
      key: 'sessionId',
      width: 140,
      render: (value: string) => (
        <span className="text-xs text-text-muted font-mono" title={value}>
          {truncateSessionId(value, 12)}
        </span>
      ),
    },
    {
      title: '状态码',
      dataIndex: 'statusCode',
      key: 'statusCode',
      width: 80,
      render: (value: number) => {
        const color = value >= 200 && value < 300 ? 'text-emerald-600' : 'text-red-600'
        return (
          <span className={`text-sm font-medium ${color}`}>
            {value}
          </span>
        )
      },
    },
    {
      title: 'Token',
      key: 'token',
      width: 140,
      render: (_: any, record: RequestSummary) => (
        <TokenMetricsCell usage={record.usage} />
      ),
    },
  ]

  return (
    <div className="h-full flex flex-col">
      <div className="flex justify-end pb-3 pr-2">
        <Button
          type="primary"
          icon={<GitCompareArrows size={16} />}
          disabled={selectedRowKeys.length !== 2}
          onClick={() => onCompare(selectedRowKeys as string[])}
        >
          {t('requests.compare') || '对比'}
        </Button>
      </div>

      <div className="flex-1 overflow-auto">
        <Table
          dataSource={displayedRequests}
          columns={columns}
          pagination={false}
          loading={externalLoading}
          onRow={(record) => ({
            onClick: () => onRowClick(record),
            className: 'cursor-pointer hover:bg-bg-hover',
          })}
          rowKey="compositeId"
          size="small"
        />
      </div>

      {hasMore && (
        <div className="flex justify-center py-4 border-t border-border">
          <Button
            loading={loadingMore}
            onClick={handleLoadMore}
          >
            加载更多
          </Button>
        </div>
      )}
    </div>
  )
}

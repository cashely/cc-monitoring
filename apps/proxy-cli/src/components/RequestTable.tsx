import { useState, useMemo, useCallback, useRef } from 'react'
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

interface TableRowData {
  key: string
  sessionId?: string
  requestCount?: number
  request?: RequestSummary
  children?: TableRowData[]
}

const PAGE_SIZE = 100

// Helper to truncate session ID
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
  const [expandedRowKeys, setExpandedRowKeys] = useState<React.Key[]>([])
  const prevInitialRequestsRef = useRef<string>('')

  // 当有新请求从 WebSocket 进来时，更新 allRequests (避免不必要的更新)
  const initialRequestsKey = JSON.stringify(initialRequests.map(r => r.compositeId))
  if (initialRequestsKey !== prevInitialRequestsRef.current) {
    prevInitialRequestsRef.current = initialRequestsKey
    setAllRequests(prev => {
      const existingIds = new Set(prev.map(r => r.compositeId))
      const newRequests = initialRequests.filter(r => !existingIds.has(r.compositeId))
      if (newRequests.length === 0) return prev
      return [...newRequests, ...prev]
    })
  }

  // 构建 antd 原生树形数据结构
  const tableData = useMemo((): TableRowData[] => {
    const sessionMap = new Map<string, RequestSummary[]>()
    const displayedRequests = allRequests.slice(0, displayedCount)

    for (const request of displayedRequests) {
      const sessionRequests = sessionMap.get(request.sessionId) || []
      sessionRequests.push(request)
      sessionMap.set(request.sessionId, sessionRequests)
    }

    const result: TableRowData[] = []
    const seenSessions = new Set<string>()

    for (const request of displayedRequests) {
      if (seenSessions.has(request.sessionId)) continue
      seenSessions.add(request.sessionId)

      const sessionRequests = sessionMap.get(request.sessionId) || []

      result.push({
        key: `session:${request.sessionId}`,
        sessionId: request.sessionId,
        requestCount: sessionRequests.length,
        children: sessionRequests.map(req => ({
          key: req.compositeId,
          request: req,
        })),
      })
    }

    return result
  }, [allRequests, displayedCount])

  // 加载更多
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

  // 表格列定义
  const columns: TableProps<TableRowData>['columns'] = [
    {
      title: '',
      key: 'checkbox',
      width: 48,
      render: (_, record) => {
        if (!record.request) return null
        return (
          <Checkbox
            checked={selectedRowKeys.includes(record.key)}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => {
              setSelectedRowKeys(prev => {
                if (e.target.checked) {
                  const newSelected = [...prev, record.key]
                  return newSelected.slice(-2)
                } else {
                  return prev.filter(k => k !== record.key)
                }
              })
            }}
          />
        )
      },
    },
    {
      title: '时间',
      dataIndex: 'timestamp',
      key: 'timestamp',
      width: 160,
      render: (_, record) => {
        if (!record.request) return null
        return (
          <span className="text-sm text-text-muted">
            {formatTime(record.request.timestamp, 'monthDayTime')}
          </span>
        )
      },
    },
    {
      title: 'Method',
      dataIndex: 'method',
      key: 'method',
      width: 100,
      render: (_, record) => {
        if (record.request) {
          return (
            <MethodTag
              method={record.request.method}
              statusCode={record.request.statusCode}
            />
          )
        }
        if (record.sessionId) {
          return (
            <span className="text-xs text-text-muted font-mono">
              {truncateSessionId(record.sessionId, 8)}
            </span>
          )
        }
        return null
      },
    },
    {
      title: 'URL',
      dataIndex: 'url',
      key: 'url',
      ellipsis: true,
      render: (_, record) => {
        if (record.request) {
          return <span className="text-sm">{record.request.path}</span>
        }
        if (record.requestCount !== undefined) {
          return (
            <span className="text-xs text-text-muted">
              {record.requestCount} 条请求
            </span>
          )
        }
        return null
      },
    },
    {
      title: '耗时',
      dataIndex: 'duration',
      key: 'duration',
      width: 80,
      render: (_, record) => {
        if (!record.request) return null
        return (
          <span className="text-xs text-text-muted">
            {(record.request.responseTime / 1000).toFixed(1)}s
          </span>
        )
      },
    },
    {
      title: '模型',
      dataIndex: 'model',
      key: 'model',
      width: 120,
      render: (_, record) => {
        if (!record.request?.model) return null
        return <ModelTag model={record.request.model} />
      },
    },
    {
      title: 'Session ID',
      dataIndex: 'sessionId',
      key: 'sessionId',
      width: 140,
      render: (_, record) => {
        if (!record.request) return null
        return (
          <span className="text-xs text-text-muted font-mono" title={record.request.sessionId}>
            {truncateSessionId(record.request.sessionId, 12)}
          </span>
        )
      },
    },
    {
      title: '状态码',
      dataIndex: 'statusCode',
      key: 'statusCode',
      width: 80,
      render: (_, record) => {
        if (!record.request) return null
        const statusCode = record.request.statusCode
        const color = statusCode >= 200 && statusCode < 300 ? 'text-emerald-600' : 'text-red-600'
        return (
          <span className={`text-sm font-medium ${color}`}>
            {statusCode}
          </span>
        )
      },
    },
    {
      title: 'Token',
      key: 'token',
      width: 140,
      render: (_, record) => {
        if (!record.request) return null
        return <TokenMetricsCell usage={record.request.usage} />
      },
    },
  ]

  const handleRowClick = (record: TableRowData) => {
    if (record.request) {
      onRowClick(record.request)
    }
  }

  const handleExpand = (expanded: boolean, record: TableRowData) => {
    setExpandedRowKeys(prev => {
      if (expanded) {
        return [...prev, record.key]
      } else {
        return prev.filter(k => k !== record.key)
      }
    })
  }

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
          dataSource={tableData}
          columns={columns}
          pagination={false}
          loading={externalLoading}
          expandable={{
            expandedRowKeys,
            onExpand: handleExpand,
            defaultExpandAllRows: true,
            indentSize: 24,
          }}
          onRow={(record) => ({
            onClick: () => handleRowClick(record),
            className: record.request ? 'cursor-pointer hover:bg-bg-hover' : '',
          })}
          rowClassName={(record) => {
            if (!record.request && record.sessionId) {
              return 'bg-bg-secondary font-medium'
            }
            return ''
          }}
          size="small"
        />
      </div>

      {hasMore && (
        <div className="flex justify-center py-4 border-t border-border">
          <Button
            loading={loadingMore}
            onClick={handleLoadMore}
          >
            {t('requests.loadMore') || '加载更多'}
          </Button>
        </div>
      )}
    </div>
  )
}

import { useState, useMemo, useCallback } from 'react'
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
  isSession: boolean
  sessionId?: string
  requestCount?: number
  timestamp?: string
  method?: string
  url?: string
  duration?: number
  model?: string
  statusCode?: number
  usage?: any
  request?: RequestSummary
  children?: TableRowData[]
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
  useMemo(() => {
    setAllRequests(prev => {
      const existingIds = new Set(prev.map(r => r.compositeId))
      const newRequests = initialRequests.filter(r => !existingIds.has(r.compositeId))
      if (newRequests.length === 0) return prev
      return [...newRequests, ...prev]
    })
  }, [initialRequests])

  // 构建树形数据
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
        isSession: true,
        sessionId: request.sessionId,
        requestCount: sessionRequests.length,
        children: sessionRequests.map(req => ({
          key: req.compositeId,
          isSession: false,
          timestamp: req.timestamp,
          method: req.method,
          url: req.path,
          duration: req.responseTime,
          model: req.model,
          statusCode: req.statusCode,
          usage: req.usage,
          request: req,
        })),
      })
    }

    return result
  }, [allRequests, displayedCount])

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

  const columns: TableProps<TableRowData>['columns'] = [
    {
      title: '',
      key: 'checkbox',
      width: 48,
      render: (_, record) => {
        if (record.isSession) return null
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
      render: (value, record) => {
        if (record.isSession) return null
        return (
          <span className="text-sm text-text-muted">
            {formatTime(value, 'monthDayTime')}
          </span>
        )
      },
    },
    {
      title: 'Method',
      dataIndex: 'method',
      key: 'method',
      width: 100,
      render: (value, record) => {
        if (record.isSession && record.sessionId) {
          return (
            <span className="text-xs text-text-muted font-mono">
              {truncateSessionId(record.sessionId, 8)}
            </span>
          )
        }
        if (!record.isSession && record.request) {
          return (
            <MethodTag
              method={record.request.method}
              statusCode={record.request.statusCode}
            />
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
      render: (value, record) => {
        if (record.isSession) {
          return (
            <span className="text-xs text-text-muted">
              {record.requestCount} 条请求
            </span>
          )
        }
        return <span className="text-sm">{value}</span>
      },
    },
    {
      title: '耗时',
      dataIndex: 'duration',
      key: 'duration',
      width: 80,
      render: (value, record) => {
        if (record.isSession) return null
        return (
          <span className="text-xs text-text-muted">
            {(value / 1000).toFixed(1)}s
          </span>
        )
      },
    },
    {
      title: '模型',
      dataIndex: 'model',
      key: 'model',
      width: 120,
      render: (value, record) => {
        if (record.isSession || !value) return null
        return <ModelTag model={value} />
      },
    },
    {
      title: 'Session ID',
      key: 'sessionId',
      width: 140,
      render: (_, record) => {
        if (record.isSession || !record.request) return null
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
      render: (value, record) => {
        if (record.isSession) return null
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
      render: (_, record) => {
        if (record.isSession) return null
        return <TokenMetricsCell usage={record.usage} />
      },
    },
  ]

  const handleRowClick = (record: TableRowData) => {
    if (!record.isSession && record.request) {
      onRowClick(record.request)
    }
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
            defaultExpandAllRows: true,
            indentSize: 24,
          }}
          onRow={(record) => ({
            onClick: () => handleRowClick(record),
            className: !record.isSession ? 'cursor-pointer hover:bg-bg-hover' : '',
          })}
          rowClassName={(record) => {
            if (record.isSession) {
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

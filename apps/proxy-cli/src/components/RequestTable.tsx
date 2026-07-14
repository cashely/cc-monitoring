import { useState, useCallback, useMemo } from 'react'
import { Table, TableProps, Button, Checkbox, Space, ConfigProvider, theme } from 'antd'
import { GitCompareArrows } from 'lucide-react'
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

  const displayedRequests = allRequests.slice(0, displayedCount)

  // 计算 rowSpan
  const rowSpanMap = useMemo(() => {
    const map = new Map<string, { index: number; count: number }>()
    let lastSessionId: string | null = null
    let currentCount = 0
    let currentStartIndex = 0

    displayedRequests.forEach((req, index) => {
      if (req.sessionId !== lastSessionId) {
        if (lastSessionId !== null) {
          map.set(lastSessionId, { index: currentStartIndex, count: currentCount })
        }
        lastSessionId = req.sessionId
        currentCount = 1
        currentStartIndex = index
      } else {
        currentCount++
      }
    })

    if (lastSessionId !== null) {
      map.set(lastSessionId, { index: currentStartIndex, count: currentCount })
    }

    return map
  }, [displayedRequests])

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
      fixed: 'left',
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
      title: 'Session ID',
      dataIndex: 'sessionId',
      key: 'sessionId',
      width: 140,
      render: (value: string, _, index: number) => {
        const spanInfo = rowSpanMap.get(value)
        const rowSpan = spanInfo && spanInfo.index === index ? spanInfo.count : 0
        return {
          children: (
            <span className="text-xs text-gray-400 font-mono" title={value}>
              {truncateSessionId(value, 12)}
            </span>
          ),
          props: { rowSpan },
        }
      },
    },
    {
      title: '时间',
      dataIndex: 'timestamp',
      key: 'timestamp',
      width: 160,
      render: (value: string) => (
        <span className="text-sm text-gray-400">
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
      render: (value: string) => <span className="text-sm text-gray-200">{value}</span>,
    },
    {
      title: '耗时',
      dataIndex: 'responseTime',
      key: 'responseTime',
      width: 80,
      render: (value: number) => (
        <span className="text-xs text-gray-400">
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
      title: '状态码',
      dataIndex: 'statusCode',
      key: 'statusCode',
      width: 80,
      render: (value: number) => {
        const color = value >= 200 && value < 300 ? 'text-emerald-400' : 'text-red-400'
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
    <ConfigProvider
      theme={{
        algorithm: theme.darkAlgorithm,
        token: {
          colorPrimary: '#3B82F6',
          borderRadius: 6,
        },
        components: {
          Table: {
            headerBg: '#1F2937',
            rowHoverBg: '#374151',
          },
        },
      }}
    >
      <div className="flex flex-col h-full">
        <Table
          dataSource={displayedRequests}
          columns={columns}
          pagination={false}
          loading={externalLoading}
          onRow={(record) => ({
            onClick: () => onRowClick(record),
            className: 'cursor-pointer',
          })}
          rowKey="compositeId"
          size="small"
          scroll={{ x: 'max-content', y: 'calc(100vh - 280px)' }}
          tableLayout="auto"
          sticky
          footer={() => (
            <div className="flex justify-end gap-3 py-4 px-4 bg-gray-900/50 border-t border-gray-700">
              <Button
                type="primary"
                icon={<GitCompareArrows size={16} />}
                disabled={selectedRowKeys.length !== 2}
                onClick={() => onCompare(selectedRowKeys as string[])}
                className="bg-blue-600 hover:bg-blue-500 text-white"
              >
                对比
              </Button>
              {hasMore && (
                <Button
                  loading={loadingMore}
                  onClick={handleLoadMore}
                  variant="outlined"
                  className="border-gray-600 text-gray-300 hover:border-gray-500 hover:text-white"
                >
                  加载更多
                </Button>
              )}
            </div>
          )}
        />
      </div>
    </ConfigProvider>
  )
}

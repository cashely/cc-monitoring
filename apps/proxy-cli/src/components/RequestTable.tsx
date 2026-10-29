import { useState, useCallback, useMemo } from 'react'
import { Table, TableProps, Button, Checkbox, Tag } from 'antd'
import { GitCompareArrows, Loader2 } from 'lucide-react'
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
const MAX_CAP = 500

// Session 颜色轮询 palette（亮色，白色文字可读，暗/亮主题均适用）
const SESSION_PALETTE = [
  '#3B82F6', // blue
  '#10B981', // emerald
  '#F59E0B', // amber
  '#06B6D4', // cyan
  '#8B5CF6', // violet
  '#EC4899', // pink
  '#14B8A6', // teal
  '#6366F1', // indigo
]

function getSessionColor(sessionId: string): string {
  // 简单确定性 hash：charCode 累加 → palette 轮询
  let hash = 0
  for (let i = 0; i < sessionId.length; i++) {
    hash = (hash * 31 + sessionId.charCodeAt(i)) | 0
  }
  return SESSION_PALETTE[Math.abs(hash) % SESSION_PALETTE.length]
}

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

  // 合并新请求（处理 pending→completed 替换）
  useMemo(() => {
    setAllRequests(prev => {
      // 如果新请求中有 pendingId，先删 prev 中对应的 pending 行
      const pendingIdsToRemove = new Set(
        initialRequests.filter(r => r.pendingId).map(r => r.pendingId!)
      )
      let base = pendingIdsToRemove.size > 0
        ? prev.filter(r => !pendingIdsToRemove.has(r.compositeId))
        : prev

      const existingIds = new Set(base.map(r => r.compositeId))
      const newRequests = initialRequests.filter(r => !existingIds.has(r.compositeId))
      if (newRequests.length === 0 && pendingIdsToRemove.size === 0) return prev

      // 新请求 + 保留的旧请求，按 timestamp 倒序
      const merged = [...newRequests, ...base]
      const sorted = merged.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      // 硬上限：超出丢最旧的（倒序数组尾部），加载更多路径不受此 cap 约束
      return sorted.length > MAX_CAP ? sorted.slice(0, MAX_CAP) : sorted
    })
  }, [initialRequests])

  // 计算每个 session 内的序号（最早的序号最小）
  const requestsWithSequence = useMemo(() => {
    const sessionGroups = new Map<string, RequestSummary[]>()

    // 按 sessionId 分组一次
    allRequests.forEach(req => {
      const group = sessionGroups.get(req.sessionId) || []
      group.push(req)
      sessionGroups.set(req.sessionId, group)
    })

    // 每组按时间正序 sort 一次，建立 compositeId → sequence 查表
    const seqMap = new Map<string, number>()
    sessionGroups.forEach(group => {
      group
        .slice()
        .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
        .forEach((req, i) => seqMap.set(req.compositeId, i + 1))
    })

    return allRequests.map(req => ({ ...req, sequence: seqMap.get(req.compositeId) }))
  }, [allRequests])

  const displayedRequests = requestsWithSequence.slice(0, displayedCount)

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

  const columns: TableProps<any>['columns'] = [
    {
      title: '',
      key: 'checkbox',
      width: 40,
      fixed: 'left',
      align: 'center',
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
      width: 200,
      render: (value: string, record: any) => {
        const sessionColor = getSessionColor(value)
        return (
          <div className="flex items-center gap-2" style={{ minWidth: 0 }}>
            {record.status === 'pending' && (
              <Loader2
                size={14}
                className="flex-shrink-0 animate-spin"
                style={{ color: sessionColor }}
              />
            )}
            <span
              className="text-xs font-mono"
              style={{
                color: sessionColor,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                maxWidth: 130,
                display: 'inline-block',
              }}
              title={value}
            >
              {truncateSessionId(value, 16)}
            </span>
          </div>
        )
      },
    },
    {
      title: '时间',
      dataIndex: 'timestamp',
      key: 'timestamp',
      width: 160,
      render: (value: string) => (
        <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
          {formatTime(value, 'monthDayTime')}
        </span>
      ),
    },
    {
      title: 'Token',
      key: 'token',
      width: 140,
      render: (_: any, record: any) => (
        <TokenMetricsCell usage={record.usage} />
      ),
    },
    {
      title: '模型',
      dataIndex: 'model',
      key: 'model',
      width: 180,
      render: (value: string) => value ? <ModelTag model={value} /> : null,
    },
    {
      title: '请求端点',
      dataIndex: 'baseUrl',
      key: 'baseUrl',
      width: 220,
      ellipsis: true,
      render: (value: string) => (
        <span className="text-xs" style={{ color: 'var(--color-text-secondary)' }} title={value}>
          {value || '-'}
        </span>
      ),
    },
    {
      title: 'UA',
      dataIndex: 'userAgent',
      key: 'userAgent',
      width: 180,
      ellipsis: true,
      render: (value: string) => (
        <span className="text-xs" style={{ color: 'var(--color-text-secondary)' }} title={value}>
          {value || '-'}
        </span>
      ),
    },
    {
      title: '耗时',
      dataIndex: 'responseTime',
      key: 'responseTime',
      width: 80,
      render: (value: number) => (
        <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
          {(value / 1000).toFixed(1)}s
        </span>
      ),
    },
    {
      title: '状态码',
      dataIndex: 'statusCode',
      key: 'statusCode',
      width: 80,
      render: (value: number) => {
        const color = value >= 200 && value < 300 ? 'var(--color-success)' : 'var(--color-error)'
        return (
          <span className="text-xs font-medium" style={{ color }}>
            {value}
          </span>
        )
      },
    },
    {
      title: 'Method',
      dataIndex: 'method',
      key: 'method',
      width: 100,
      render: (_: any, record: any) => (
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
      render: (value: string) => <span className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>{value}</span>,
    },
    {
      title: '机器码',
      dataIndex: 'machineId',
      key: 'machineId',
      width: 180,
      render: (value: string) => (
        <span
          className="text-xs font-mono"
          style={{
            color: 'var(--color-text-muted)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            maxWidth: 160,
            display: 'inline-block',
          }}
          title={value}
        >
          {value || '-'}
        </span>
      ),
    },
  ]

  return (
    <div className="flex flex-col">
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
        scroll={{ x: 1600, y: 'calc(100vh - 200px)' }}
        tableLayout="auto"
        sticky
        footer={() => (
          <div className="flex justify-end gap-3 py-4 px-4 border-t" style={{ borderColor: 'var(--color-border)' }}>
            <Button
              type="primary"
              icon={<GitCompareArrows size={16} />}
              disabled={selectedRowKeys.length !== 2}
              onClick={() => onCompare(selectedRowKeys as string[])}
            >
              对比
            </Button>
            {hasMore && (
              <Button
                loading={loadingMore}
                onClick={handleLoadMore}
                variant="outlined"
              >
                加载更多
              </Button>
            )}
          </div>
        )}
      />
    </div>
  )
}

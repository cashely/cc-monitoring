import { render, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { RequestTable } from './RequestTable'
import { RequestSummary } from '../types/request'

function makeRow(over: Partial<RequestSummary> = {}): RequestSummary {
  return {
    requestId: 'r1',
    sessionId: 'sess-abc',
    compositeId: 'sess-abc:r1',
    timestamp: new Date().toISOString(),
    method: 'POST',
    path: '/v1/chat/completions',
    statusCode: 0,
    responseTime: 0,
    ...over,
  }
}

const noopProps = {
  onCompare: vi.fn(),
  onRowClick: vi.fn(),
  selectedRowKeys: [] as string[],
  onSelectedRowKeysChange: vi.fn(),
}

// 按列标题定位行内单元格
function cellByTitle(rowKey: string, title: string): HTMLElement {
  const headers = Array.from(document.querySelectorAll('thead th'))
  const colIdx = headers.findIndex(th => th.textContent?.includes(title))
  const row = document.querySelector(`tr[data-row-key="${rowKey}"]`) as HTMLElement
  return row.querySelectorAll('td')[colIdx]
}

function spinner(rowKey: string): Element | null {
  const row = document.querySelector(`tr[data-row-key="${rowKey}"]`)
  return row!.querySelector('svg.animate-spin')
}

describe('RequestTable row merge', () => {
  it('replaces pending row with completed row on same compositeId', () => {
    const pending = makeRow({ status: 'pending' })
    const { rerender } = render(<RequestTable initialRequests={[pending]} {...noopProps} />)
    expect(spinner(pending.compositeId)).not.toBeNull()
    expect(cellByTitle(pending.compositeId, '状态码')).toHaveTextContent('0')

    const completed = makeRow({ status: 'completed', statusCode: 200, responseTime: 1200 })
    rerender(<RequestTable initialRequests={[completed]} {...noopProps} />)
    expect(spinner(completed.compositeId)).toBeNull()
    expect(cellByTitle(completed.compositeId, '状态码')).toHaveTextContent('200')
  })

  it('updates status code at headers stage while keeping spinner', () => {
    const initial = makeRow({ status: 'pending' })
    const { rerender } = render(<RequestTable initialRequests={[initial]} {...noopProps} />)

    const withHeaders = makeRow({ status: 'pending', statusCode: 200 })
    rerender(<RequestTable initialRequests={[withHeaders]} {...noopProps} />)
    expect(spinner(withHeaders.compositeId)).not.toBeNull()
    expect(cellByTitle(withHeaders.compositeId, '状态码')).toHaveTextContent('200')
  })

  it('shows interrupted immediately on closedAt row, without waiting for stale timeout', () => {
    const initial = makeRow({ status: 'pending' })
    const { rerender } = render(<RequestTable initialRequests={[initial]} {...noopProps} />)

    const interrupted = makeRow({
      status: 'completed',
      statusCode: 0,
      closedAt: new Date().toISOString(),
      error: 'socket hang up',
    })
    rerender(<RequestTable initialRequests={[interrupted]} {...noopProps} />)
    expect(spinner(interrupted.compositeId)).toBeNull()
    expect(cellByTitle(interrupted.compositeId, '状态码')).toHaveTextContent('中断')
  })

  it('keeps pendingId migration: pending row replaced by row with new compositeId', () => {
    const pending = makeRow({
      requestId: 'local-1',
      compositeId: 'sess-abc:local-1',
      status: 'pending',
    })
    const { rerender } = render(<RequestTable initialRequests={[pending]} {...noopProps} />)

    const migrated = makeRow({
      requestId: 'cloud-1',
      compositeId: 'sess-abc:cloud-1',
      pendingId: 'sess-abc:local-1',
      status: 'completed',
      statusCode: 200,
      responseTime: 800,
    })
    rerender(<RequestTable initialRequests={[migrated]} {...noopProps} />)
    expect(document.querySelector('tr[data-row-key="sess-abc:local-1"]')).toBeNull()
    expect(document.querySelector('tr[data-row-key="sess-abc:cloud-1"]')).toBeTruthy()
    expect(spinner('sess-abc:cloud-1')).toBeNull()
    expect(cellByTitle('sess-abc:cloud-1', '状态码')).toHaveTextContent('200')
  })
})

describe('RequestTable session tree', () => {
  const base = Date.now()

  it('groups a multi-request session into one collapsed parent showing the newest request', () => {
    const older = makeRow({
      requestId: 'r1',
      compositeId: 'sess-abc:r1',
      statusCode: 200,
      timestamp: new Date(base - 60_000).toISOString(),
    })
    const newer = makeRow({
      requestId: 'r2',
      compositeId: 'sess-abc:r2',
      statusCode: 201,
      timestamp: new Date(base - 30_000).toISOString(),
    })
    render(<RequestTable initialRequests={[newer, older]} {...noopProps} />)

    // 一个 session 组 → 顶层仅一行
    expect(document.querySelectorAll('tbody tr[data-row-key]')).toHaveLength(1)

    const parent = document.querySelector('tr[data-row-key="session::sess-abc"]')
    expect(parent).not.toBeNull()

    // 默认折叠：子行不渲染
    expect(document.querySelector('tr[data-row-key="sess-abc:r1"]')).toBeNull()
    expect(document.querySelector('tr[data-row-key="sess-abc:r2"]')).toBeNull()

    // 父行展示最新（newer）请求的数据
    expect(cellByTitle('session::sess-abc', '状态码')).toHaveTextContent('201')

    // 计数标记
    expect(cellByTitle('session::sess-abc', 'Session ID')).toHaveTextContent('×2')

    // 父行无 checkbox
    expect(parent!.querySelector('input[type="checkbox"]')).toBeNull()
  })

  it('keeps a session with one request as a flat row', () => {
    const only = makeRow({
      requestId: 'r1',
      compositeId: 'sess-abc:r1',
      statusCode: 200,
    })
    render(<RequestTable initialRequests={[only]} {...noopProps} />)

    expect(document.querySelector('tr[data-row-key="session::sess-abc"]')).toBeNull()
    const row = document.querySelector('tr[data-row-key="sess-abc:r1"]')
    expect(row).not.toBeNull()
    expect(cellByTitle('sess-abc:r1', 'Session ID')).toHaveTextContent('sess-abc')
    expect(row!.querySelector('input[type="checkbox"]')).not.toBeNull()
  })

  it('renders one top-level row per session in first-occurrence order', () => {
    // 倒序：a2（最新）→ b1 → a1（最旧）
    const a1 = makeRow({
      sessionId: 'sess-a', requestId: '1', compositeId: 'sess-a:1',
      statusCode: 200, timestamp: new Date(base - 70_000).toISOString(),
    })
    const b1 = makeRow({
      sessionId: 'sess-b', requestId: '1', compositeId: 'sess-b:1',
      statusCode: 200, timestamp: new Date(base - 40_000).toISOString(),
    })
    const a2 = makeRow({
      sessionId: 'sess-a', requestId: '2', compositeId: 'sess-a:2',
      statusCode: 200, timestamp: new Date(base - 10_000).toISOString(),
    })
    render(<RequestTable initialRequests={[a1, b1, a2]} {...noopProps} />)

    const keys = Array.from(document.querySelectorAll('tbody tr[data-row-key]')).map(
      tr => tr.getAttribute('data-row-key')
    )
    expect(keys).toEqual(['session::sess-a', 'sess-b:1'])
  })

  it('expands a parent to show children newest-first and routes row clicks', () => {
    const onRowClick = vi.fn()
    const older = makeRow({
      requestId: 'r1',
      compositeId: 'sess-abc:r1',
      statusCode: 200,
      timestamp: new Date(base - 60_000).toISOString(),
    })
    const newer = makeRow({
      requestId: 'r2',
      compositeId: 'sess-abc:r2',
      statusCode: 201,
      timestamp: new Date(base - 30_000).toISOString(),
    })
    render(<RequestTable initialRequests={[newer, older]} {...noopProps} onRowClick={onRowClick} />)

    // 点击父行：仅切换展开，不打开详情
    fireEvent.click(document.querySelector('tr[data-row-key="session::sess-abc"]')!)
    expect(onRowClick).not.toHaveBeenCalled()

    // 展开后：父行 + 子行（最新在前）
    const keys = Array.from(document.querySelectorAll('tbody tr[data-row-key]')).map(
      tr => tr.getAttribute('data-row-key')
    )
    expect(keys).toEqual(['session::sess-abc', 'sess-abc:r2', 'sess-abc:r1'])

    // 子行 Session ID 列留空，但 checkbox 保留
    expect(cellByTitle('sess-abc:r2', 'Session ID').textContent).toBe('')
    expect(
      document.querySelector('tr[data-row-key="sess-abc:r2"] input[type="checkbox"]')
    ).not.toBeNull()

    // 点击子行：打开该请求详情
    fireEvent.click(document.querySelector('tr[data-row-key="sess-abc:r2"]')!)
    expect(onRowClick).toHaveBeenCalledTimes(1)
    expect(onRowClick).toHaveBeenCalledWith(expect.objectContaining({ compositeId: 'sess-abc:r2' }))
  })
})

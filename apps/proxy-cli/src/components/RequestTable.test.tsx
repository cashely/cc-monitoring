import { render } from '@testing-library/react'
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

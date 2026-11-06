import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { RequestHistory } from './RequestHistory'
import { RequestSummary } from '../types/request'

vi.mock('./RequestCompareModal', () => ({
  RequestCompareModal: ({ leftId, rightId, onClose }: any) => (
    <div data-testid="compare-modal" data-left={leftId} data-right={rightId}>
      <button onClick={onClose}>close</button>
    </div>
  ),
}))

function makeSummary(id: string): RequestSummary {
  return {
    requestId: id,
    sessionId: 's',
    compositeId: id,
    timestamp: '2026-06-29T10:00:00Z',
    method: 'POST',
    path: '/v1/x',
    statusCode: 200,
    responseTime: 10,
  }
}

function makeSummaryInSession(id: string, sessionId: string): RequestSummary {
  return { ...makeSummary(id), sessionId }
}

// RequestTable 为扁平表格，每行 checkbox 在对应 data-row-key 的 tr 内
function rowCheckbox(id: string): HTMLInputElement {
  const row = document.querySelector(`tr[data-row-key="${id}"]`)
  return row!.querySelector('input[type="checkbox"]') as HTMLInputElement
}

function dataRowKeys(): string[] {
  return Array.from(document.querySelectorAll('tbody tr[data-row-key]')).map(
    tr => tr.getAttribute('data-row-key')!
  )
}

describe('RequestHistory compare', () => {
  it('renders compare button disabled initially', () => {
    render(<RequestHistory requests={[makeSummary('a')]} />)
    const btn = screen.getByRole('button', { name: /对比|Compare/ })
    expect(btn).toBeDisabled()
  })

  it('enables compare button when exactly 2 selected', () => {
    render(<RequestHistory requests={[makeSummary('a'), makeSummary('b'), makeSummary('c')]} />)
    fireEvent.click(rowCheckbox('a'))
    fireEvent.click(rowCheckbox('b'))
    expect(screen.getByRole('button', { name: /对比|Compare/ })).not.toBeDisabled()
  })

  it('FIFO: selecting 3rd evicts earliest', () => {
    render(<RequestHistory requests={[makeSummary('a'), makeSummary('b'), makeSummary('c')]} />)
    fireEvent.click(rowCheckbox('a'))
    fireEvent.click(rowCheckbox('b'))
    fireEvent.click(rowCheckbox('c'))

    expect(rowCheckbox('a')).not.toBeChecked()
    expect(rowCheckbox('b')).toBeChecked()
    expect(rowCheckbox('c')).toBeChecked()
  })

  it('opens modal with selected ids on compare click', () => {
    render(<RequestHistory requests={[makeSummary('a'), makeSummary('b')]} />)
    fireEvent.click(rowCheckbox('a'))
    fireEvent.click(rowCheckbox('b'))
    fireEvent.click(screen.getByRole('button', { name: /对比|Compare/ }))

    const modal = screen.getByTestId('compare-modal')
    expect(modal.getAttribute('data-left')).toBe('a')
    expect(modal.getAttribute('data-right')).toBe('b')
  })

  it('clears row selection when modal closes', () => {
    render(<RequestHistory requests={[makeSummary('a'), makeSummary('b')]} />)
    fireEvent.click(rowCheckbox('a'))
    fireEvent.click(rowCheckbox('b'))
    fireEvent.click(screen.getByRole('button', { name: /对比|Compare/ }))
    fireEvent.click(screen.getByText('close'))

    // Modal unmounts
    expect(screen.queryByTestId('compare-modal')).toBeNull()
    // 关闭弹窗后重置行 checkbox
    expect(rowCheckbox('a')).not.toBeChecked()
    expect(rowCheckbox('b')).not.toBeChecked()
  })

  it('deselects on second click of same checkbox', () => {
    render(<RequestHistory requests={[makeSummary('a'), makeSummary('b')]} />)
    fireEvent.click(rowCheckbox('a'))
    expect(rowCheckbox('a')).toBeChecked()
    fireEvent.click(rowCheckbox('a'))
    expect(rowCheckbox('a')).not.toBeChecked()
  })
})

describe('RequestHistory session grouping', () => {
  it('shows sessionId on each of its rows', () => {
    render(
      <RequestHistory
        requests={[
          makeSummaryInSession('a', 's1'),
          makeSummaryInSession('b', 's1'),
          makeSummaryInSession('c', 's2'),
        ]}
      />
    )
    // s1 关联两行，s2 关联一行
    expect(screen.getAllByText('s1').length).toBe(2)
    expect(screen.getByText('s2')).toBeInTheDocument()
  })

  it('renders all rows directly (flat table, no collapse)', () => {
    render(
      <RequestHistory
        requests={[makeSummaryInSession('a', 's1'), makeSummaryInSession('b', 's1')]}
      />
    )
    expect(document.querySelector('tr[data-row-key="a"]')).toBeTruthy()
    expect(document.querySelector('tr[data-row-key="b"]')).toBeTruthy()
  })

  it('preserves order: equal-timestamp rows keep input order', () => {
    render(
      <RequestHistory
        requests={[
          makeSummaryInSession('a', 's1'),
          makeSummaryInSession('c', 's2'),
          makeSummaryInSession('b', 's1'),
        ]}
      />
    )
    expect(dataRowKeys()).toEqual(['a', 'c', 'b'])
  })
})

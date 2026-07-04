import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { RequestHistory } from './RequestHistory'
import { RequestSummary } from '../types/request'

vi.mock('./RequestCard', () => ({
  RequestCard: ({ summary, isSelected, onToggleSelect }: any) => (
    <div data-testid={`card-${summary.compositeId}`}>
      <input
        type="checkbox"
        data-testid={`cb-${summary.compositeId}`}
        checked={!!isSelected}
        onChange={() => onToggleSelect?.(summary.compositeId)}
      />
    </div>
  ),
}))

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

// 分组默认收起，需先展开对应 session 才能看到组内卡片
function expandSession(sessionId: string): void {
  fireEvent.click(screen.getByTestId(`session-toggle-${sessionId}`))
}

describe('RequestHistory compare', () => {
  it('renders compare button disabled initially', () => {
    render(<RequestHistory requests={[makeSummary('a')]} />)
    const btn = screen.getByRole('button', { name: /对比|Compare/ })
    expect(btn).toBeDisabled()
  })

  it('enables compare button when exactly 2 selected', () => {
    render(<RequestHistory requests={[makeSummary('a'), makeSummary('b'), makeSummary('c')]} />)
    expandSession('s')
    fireEvent.click(screen.getByTestId('cb-a'))
    fireEvent.click(screen.getByTestId('cb-b'))
    expect(screen.getByRole('button', { name: /对比|Compare/ })).not.toBeDisabled()
  })

  it('FIFO: selecting 3rd evicts earliest', () => {
    render(<RequestHistory requests={[makeSummary('a'), makeSummary('b'), makeSummary('c')]} />)
    expandSession('s')
    fireEvent.click(screen.getByTestId('cb-a'))
    fireEvent.click(screen.getByTestId('cb-b'))
    fireEvent.click(screen.getByTestId('cb-c'))

    expect(screen.getByTestId('cb-a')).not.toBeChecked()
    expect(screen.getByTestId('cb-b')).toBeChecked()
    expect(screen.getByTestId('cb-c')).toBeChecked()
  })

  it('opens modal with selected ids on compare click', () => {
    render(<RequestHistory requests={[makeSummary('a'), makeSummary('b')]} />)
    expandSession('s')
    fireEvent.click(screen.getByTestId('cb-a'))
    fireEvent.click(screen.getByTestId('cb-b'))
    fireEvent.click(screen.getByRole('button', { name: /对比|Compare/ }))

    const modal = screen.getByTestId('compare-modal')
    expect(modal.getAttribute('data-left')).toBe('a')
    expect(modal.getAttribute('data-right')).toBe('b')
  })

  it('clears selection when modal closes', () => {
    render(<RequestHistory requests={[makeSummary('a'), makeSummary('b')]} />)
    expandSession('s')
    fireEvent.click(screen.getByTestId('cb-a'))
    fireEvent.click(screen.getByTestId('cb-b'))
    fireEvent.click(screen.getByRole('button', { name: /对比|Compare/ }))
    fireEvent.click(screen.getByText('close'))

    expect(screen.getByTestId('cb-a')).not.toBeChecked()
    expect(screen.getByTestId('cb-b')).not.toBeChecked()
  })

  it('deselects on second click of same checkbox', () => {
    render(<RequestHistory requests={[makeSummary('a'), makeSummary('b')]} />)
    expandSession('s')
    fireEvent.click(screen.getByTestId('cb-a'))
    expect(screen.getByTestId('cb-a')).toBeChecked()
    fireEvent.click(screen.getByTestId('cb-a'))
    expect(screen.getByTestId('cb-a')).not.toBeChecked()
  })
})

describe('RequestHistory session grouping', () => {
  it('groups requests by sessionId with a header showing session id and count', () => {
    render(
      <RequestHistory
        requests={[
          makeSummaryInSession('a', 's1'),
          makeSummaryInSession('b', 's1'),
          makeSummaryInSession('c', 's2'),
        ]}
      />
    )
    // 两个 session 标题各出现一次
    expect(screen.getByText('s1')).toBeInTheDocument()
    expect(screen.getByText('s2')).toBeInTheDocument()
    // s1 组数量为 2，s2 组数量为 1
    expect(screen.getByText('2')).toBeInTheDocument()
    expect(screen.getByText('1')).toBeInTheDocument()
  })

  it('collapses groups by default and toggles items on header count click', () => {
    render(
      <RequestHistory
        requests={[makeSummaryInSession('a', 's1'), makeSummaryInSession('b', 's1')]}
      />
    )
    // 默认收起：卡片不渲染
    expect(screen.queryByTestId('card-a')).toBeNull()
    // 点击条数展开
    expandSession('s1')
    expect(screen.getByTestId('card-a')).toBeInTheDocument()
    expect(screen.getByTestId('card-b')).toBeInTheDocument()
    // 再次点击收起
    expandSession('s1')
    expect(screen.queryByTestId('card-a')).toBeNull()
  })

  it('preserves order: session groups follow first-appearance, items keep input order', () => {
    render(
      <RequestHistory
        requests={[
          makeSummaryInSession('a', 's1'),
          makeSummaryInSession('c', 's2'),
          makeSummaryInSession('b', 's1'),
        ]}
      />
    )
    expandSession('s1')
    expandSession('s2')
    const cards = screen.getAllByTestId(/^card-/)
    // s1 组（a, b）在前，s2 组（c）在后
    expect(cards.map((el) => el.getAttribute('data-testid'))).toEqual([
      'card-a',
      'card-b',
      'card-c',
    ])
  })
})

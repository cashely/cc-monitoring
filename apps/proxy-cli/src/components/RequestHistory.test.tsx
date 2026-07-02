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

describe('RequestHistory compare', () => {
  it('renders compare button disabled initially', () => {
    render(<RequestHistory requests={[makeSummary('a')]} />)
    const btn = screen.getByRole('button', { name: /对比|Compare/ })
    expect(btn).toBeDisabled()
  })

  it('enables compare button when exactly 2 selected', () => {
    render(<RequestHistory requests={[makeSummary('a'), makeSummary('b'), makeSummary('c')]} />)
    fireEvent.click(screen.getByTestId('cb-a'))
    fireEvent.click(screen.getByTestId('cb-b'))
    expect(screen.getByRole('button', { name: /对比|Compare/ })).not.toBeDisabled()
  })

  it('FIFO: selecting 3rd evicts earliest', () => {
    render(<RequestHistory requests={[makeSummary('a'), makeSummary('b'), makeSummary('c')]} />)
    fireEvent.click(screen.getByTestId('cb-a'))
    fireEvent.click(screen.getByTestId('cb-b'))
    fireEvent.click(screen.getByTestId('cb-c'))

    expect(screen.getByTestId('cb-a')).not.toBeChecked()
    expect(screen.getByTestId('cb-b')).toBeChecked()
    expect(screen.getByTestId('cb-c')).toBeChecked()
  })

  it('opens modal with selected ids on compare click', () => {
    render(<RequestHistory requests={[makeSummary('a'), makeSummary('b')]} />)
    fireEvent.click(screen.getByTestId('cb-a'))
    fireEvent.click(screen.getByTestId('cb-b'))
    fireEvent.click(screen.getByRole('button', { name: /对比|Compare/ }))

    const modal = screen.getByTestId('compare-modal')
    expect(modal.getAttribute('data-left')).toBe('a')
    expect(modal.getAttribute('data-right')).toBe('b')
  })

  it('clears selection when modal closes', () => {
    render(<RequestHistory requests={[makeSummary('a'), makeSummary('b')]} />)
    fireEvent.click(screen.getByTestId('cb-a'))
    fireEvent.click(screen.getByTestId('cb-b'))
    fireEvent.click(screen.getByRole('button', { name: /对比|Compare/ }))
    fireEvent.click(screen.getByText('close'))

    expect(screen.getByTestId('cb-a')).not.toBeChecked()
    expect(screen.getByTestId('cb-b')).not.toBeChecked()
  })

  it('deselects on second click of same checkbox', () => {
    render(<RequestHistory requests={[makeSummary('a'), makeSummary('b')]} />)
    fireEvent.click(screen.getByTestId('cb-a'))
    expect(screen.getByTestId('cb-a')).toBeChecked()
    fireEvent.click(screen.getByTestId('cb-a'))
    expect(screen.getByTestId('cb-a')).not.toBeChecked()
  })
})

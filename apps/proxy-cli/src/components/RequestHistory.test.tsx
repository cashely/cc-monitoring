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
    // 默认每条一个 session → 扁平行，供 compare/勾选类测试直接访问 checkbox
    sessionId: `sess-${id}`,
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

// checkbox 在对应 data-row-key 的 tr 内（扁平行 / 展开后的子行）
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
  it('shows sessionId on parent and flat row; child session cells stay empty', () => {
    render(
      <RequestHistory
        requests={[
          makeSummaryInSession('a', 's1'),
          makeSummaryInSession('b', 's1'),
          makeSummaryInSession('c', 's2'),
        ]}
      />
    )
    // 默认折叠：s1 只出现在父行一次（带 ×2 计数），s2 为扁平行
    expect(screen.getAllByText('s1')).toHaveLength(1)
    expect(screen.getByText('s2')).toBeInTheDocument()
    expect(
      document.querySelector('tr[data-row-key="session::s1"]')
    ).toHaveTextContent('×2')

    // 展开后子行 Session ID 列留空，s1 仍只出现一次
    fireEvent.click(document.querySelector('tr[data-row-key="session::s1"]')!)
    expect(screen.getAllByText('s1')).toHaveLength(1)
  })

  it('groups same-session rows under a collapsed parent; children render after expand', () => {
    render(
      <RequestHistory
        requests={[makeSummaryInSession('a', 's1'), makeSummaryInSession('b', 's1')]}
      />
    )
    // 默认折叠：子行不渲染，父行存在且无 checkbox
    expect(document.querySelector('tr[data-row-key="a"]')).toBeNull()
    expect(document.querySelector('tr[data-row-key="b"]')).toBeNull()
    const parent = document.querySelector('tr[data-row-key="session::s1"]')
    expect(parent).toBeTruthy()
    expect(parent!.querySelector('input[type="checkbox"]')).toBeNull()

    // 展开后子行出现
    fireEvent.click(parent!)
    expect(document.querySelector('tr[data-row-key="a"]')).toBeTruthy()
    expect(document.querySelector('tr[data-row-key="b"]')).toBeTruthy()
  })

  it('preserves order: parent/flat rows keep first-occurrence order, children keep input order', () => {
    render(
      <RequestHistory
        requests={[
          makeSummaryInSession('a', 's1'),
          makeSummaryInSession('c', 's2'),
          makeSummaryInSession('b', 's1'),
        ]}
      />
    )
    // 折叠时顶层按首次出现顺序：s1 父行 → s2 扁平行
    expect(dataRowKeys()).toEqual(['session::s1', 'c'])

    // 展开 s1：子行 a、b 保持输入顺序，整体为 父行 → a → b → c
    fireEvent.click(document.querySelector('tr[data-row-key="session::s1"]')!)
    expect(dataRowKeys()).toEqual(['session::s1', 'a', 'b', 'c'])
  })
})

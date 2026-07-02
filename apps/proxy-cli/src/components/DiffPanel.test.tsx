import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { DiffPanel } from './DiffPanel'

// Mock @pierre/diffs/react 的 FileDiff, 避免真实 Shiki runtime
vi.mock('@pierre/diffs/react', () => ({
  FileDiff: ({ fileDiff }: { fileDiff: any }) => (
    <div
      data-testid="mock-filediff"
      data-name={fileDiff?.name}
      data-prevname={fileDiff?.prevName}
      data-additions={fileDiff?.additionLines?.length ?? 0}
      data-deletions={fileDiff?.deletionLines?.length ?? 0}
    >
      {fileDiff?.additionLines?.length ?? 0} additions,{' '}
      {fileDiff?.deletionLines?.length ?? 0} deletions
    </div>
  )
}))

describe('DiffPanel', () => {
  it('renders FileDiff when both sides have content', () => {
    render(<DiffPanel leftText='{"a":1}' rightText='{"a":2}' lang="json" />)
    const panel = screen.getByTestId('mock-filediff')
    expect(panel).toBeDefined()
    // Verify real data flowed through to FileDiff, not just that mock rendered.
    expect(panel.getAttribute('data-name')).toBe('right.json')
    expect(panel.getAttribute('data-prevname')).toBe('left.json')
    expect(Number(panel.getAttribute('data-additions'))).toBeGreaterThan(0)
    expect(Number(panel.getAttribute('data-deletions'))).toBeGreaterThan(0)
  })

  it('renders empty placeholder when leftText is empty', () => {
    render(<DiffPanel leftText='' rightText='{"a":2}' lang="json" />)
    expect(screen.getByText(/无数据/)).toBeDefined()
  })

  it('renders empty placeholder when rightText is empty', () => {
    render(<DiffPanel leftText='{"a":1}' rightText='' lang="json" />)
    expect(screen.getByText(/无数据/)).toBeDefined()
  })
})

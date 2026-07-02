import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { RequestCard } from './RequestCard'
import { RequestSummary } from '../types/request'

// Mock ShikiHighlighter so tests don't need real shiki runtime
vi.mock('./ShikiHighlighter', () => ({
  ShikiHighlighter: ({ code }: { code: string }) => (
    <pre>{code}</pre>
  )
}))

// Mock fetch
global.fetch = vi.fn()

describe('RequestCard', () => {
  const mockSummary: RequestSummary = {
    requestId: 'test-123',
    sessionId: 'session-abc',
    compositeId: 'session-abc:test-123',
    timestamp: '2026-06-23T10:00:00Z',
    method: 'POST',
    path: '/v1/test',
    statusCode: 200,
    responseTime: 45,
    model: 'claude-3-5-sonnet',
    usage: {
      input_tokens: 100,
      output_tokens: 50,
    },
  }

  it('should render collapsed summary by default', () => {
    render(<RequestCard summary={mockSummary} />)

    expect(screen.getByText('POST')).toBeDefined()
    expect(screen.getByText('/v1/test')).toBeDefined()
    expect(screen.getByRole('button', { name: /expand/i })).toBeDefined()
  })

  it('displays model tag after status text', () => {
    render(<RequestCard summary={mockSummary} />)

    // Find status text
    const statusText = screen.getByText(/200 OK \(45ms\)/)
    expect(statusText).toBeInTheDocument()

    // Find model tag
    const modelTag = screen.getByText('claude-3-5-sonnet')
    expect(modelTag).toBeInTheDocument()

    // Verify model tag has purple styling
    expect(modelTag).toHaveClass('bg-purple-500/20')
  })

  describe('compare checkbox', () => {
    it('renders checkbox when onToggleSelect provided', () => {
      render(
        <RequestCard
          summary={mockSummary}
          isSelected={false}
          onToggleSelect={() => {}}
        />
      )
      const checkbox = screen.getByRole('checkbox')
      expect(checkbox).not.toBeChecked()
    })

    it('reflects isSelected in checkbox checked state', () => {
      render(
        <RequestCard
          summary={mockSummary}
          isSelected={true}
          onToggleSelect={() => {}}
        />
      )
      expect(screen.getByRole('checkbox')).toBeChecked()
    })

    it('calls onToggleSelect with compositeId on change, without expanding', () => {
      const onToggleSelect = vi.fn()
      const onExpand = vi.fn()
      render(
        <RequestCard
          summary={mockSummary}
          onExpand={onExpand}
          onToggleSelect={onToggleSelect}
        />
      )
      fireEvent.click(screen.getByRole('checkbox'))
      expect(onToggleSelect).toHaveBeenCalledWith(mockSummary.compositeId)
      expect(onExpand).not.toHaveBeenCalled()
    })

    it('does not render checkbox when onToggleSelect not provided', () => {
      render(<RequestCard summary={mockSummary} />)
      expect(screen.queryByRole('checkbox')).toBeNull()
    })
  })

})

// IntersectionObserver基本测试
describe('RequestCard with IntersectionObserver', () => {
  it('renders collapsed card by default', () => {
    const mockSummary = {
      requestId: 'req-1',
      compositeId: 'comp-1',
      timestamp: '2024-01-01T00:00:00Z',
      method: 'POST',
      path: '/v1/messages',
      statusCode: 200,
      responseTime: 150,
    }

    render(<RequestCard summary={mockSummary} />)
    expect(screen.getByText('POST')).toBeInTheDocument()
    expect(screen.getByText('/v1/messages')).toBeInTheDocument()
  })
})

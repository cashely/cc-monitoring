import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { RequestCompareModal } from './RequestCompareModal'
import { RequestDetails } from '../types/request'

// Mock DiffPanel, avoid dependency on real diff library
vi.mock('./DiffPanel', () => ({
  DiffPanel: ({ leftText, rightText }: { leftText: string; rightText: string }) => (
    <div data-testid="mock-diffpanel" data-left={leftText} data-right={rightText} />
  )
}))

// Mock fetch
global.fetch = vi.fn()

function makeDetails(id: string, body: string): RequestDetails {
  return {
    requestId: id,
    request: {
      method: 'POST',
      path: '/v1/messages',
      headers: { 'x-req': id },
      body: { content: body },
    },
    response: {
      statusCode: 200,
      headers: { 'x-res': id },
      events: [{ type: 'message_start', data: body }],
    },
  }
}

describe('RequestCompareModal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders loading state initially', async () => {
    ;(global.fetch as any).mockImplementation(() => new Promise(() => {})) // never resolves
    render(<RequestCompareModal leftId="a" rightId="b" onClose={vi.fn()} />)
    expect(screen.getByText(/加载中|Loading/i)).toBeDefined()
  })

  it('renders 4 tabs and diff content after fetch resolves', async () => {
    ;(global.fetch as any)
      .mockResolvedValueOnce({ ok: true, json: async () => makeDetails('a', 'A') })
      .mockResolvedValueOnce({ ok: true, json: async () => makeDetails('b', 'B') })

    render(<RequestCompareModal leftId="a" rightId="b" onClose={vi.fn()} />)

    await waitFor(() => {
      expect(screen.getByTestId('mock-diffpanel')).toBeDefined()
    })

    // 4 tab labels exist
    expect(screen.getByText(/请求 Headers|Request Headers/)).toBeDefined()
    expect(screen.getByText(/请求 Body|Request Body/)).toBeDefined()
    expect(screen.getByText(/响应 Headers|Response Headers/)).toBeDefined()
    expect(screen.getByText(/响应 Body|Response Body/)).toBeDefined()

    // Default tab is reqHeaders, diff panel receives header JSON
    const panel = screen.getByTestId('mock-diffpanel')
    expect(panel.getAttribute('data-left')).toContain('"x-req": "a"')
    expect(panel.getAttribute('data-right')).toContain('"x-req": "b"')
  })

  it('switches to reqBody tab on click', async () => {
    ;(global.fetch as any)
      .mockResolvedValueOnce({ ok: true, json: async () => makeDetails('a', 'A') })
      .mockResolvedValueOnce({ ok: true, json: async () => makeDetails('b', 'B') })

    render(<RequestCompareModal leftId="a" rightId="b" onClose={vi.fn()} />)

    await waitFor(() => expect(screen.getByTestId('mock-diffpanel')).toBeDefined())

    fireEvent.click(screen.getByText(/请求 Body|Request Body/))

    const panel = screen.getByTestId('mock-diffpanel')
    expect(panel.getAttribute('data-left')).toContain('"content": "A"')
    expect(panel.getAttribute('data-right')).toContain('"content": "B"')
  })

  it('shows error banner when one fetch fails', async () => {
    ;(global.fetch as any)
      .mockResolvedValueOnce({ ok: true, json: async () => makeDetails('a', 'A') })
      .mockRejectedValueOnce(new Error('network boom'))

    render(<RequestCompareModal leftId="a" rightId="b" onClose={vi.fn()} />)

    await waitFor(() => {
      expect(screen.getByText(/加载失败|Load failed/i)).toBeDefined()
    })
  })

  it('calls onClose when backdrop clicked', async () => {
    ;(global.fetch as any)
      .mockResolvedValueOnce({ ok: true, json: async () => makeDetails('a', 'A') })
      .mockResolvedValueOnce({ ok: true, json: async () => makeDetails('b', 'B') })

    const onClose = vi.fn()
    const { container } = render(<RequestCompareModal leftId="a" rightId="b" onClose={onClose} />)

    await waitFor(() => expect(screen.getByTestId('mock-diffpanel')).toBeDefined())

    // Click the outer overlay (first child of container is the fixed overlay div)
    fireEvent.click(container.firstChild as HTMLElement)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('calls onClose when close button clicked', async () => {
    ;(global.fetch as any)
      .mockResolvedValueOnce({ ok: true, json: async () => makeDetails('a', 'A') })
      .mockResolvedValueOnce({ ok: true, json: async () => makeDetails('b', 'B') })

    const onClose = vi.fn()
    render(<RequestCompareModal leftId="a" rightId="b" onClose={onClose} />)

    await waitFor(() => expect(screen.getByTestId('mock-diffpanel')).toBeDefined())

    fireEvent.click(screen.getByRole('button', { name: /关闭|Close/i }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('calls onClose when loading backdrop clicked', () => {
    ;(global.fetch as any).mockImplementation(() => new Promise(() => {})) // never resolves

    const onClose = vi.fn()
    const { container } = render(<RequestCompareModal leftId="a" rightId="b" onClose={onClose} />)

    // Loading overlay is the first child
    fireEvent.click(container.firstChild as HTMLElement)
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})

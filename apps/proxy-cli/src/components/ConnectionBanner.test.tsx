import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { ConnectionBanner } from './ConnectionBanner'

describe('ConnectionBanner', () => {
  it('renders nothing when connected', () => {
    const { container } = render(<ConnectionBanner connected={true} />)
    expect(container.innerHTML).toBe('')
  })

  it('renders warning banner when disconnected', () => {
    render(<ConnectionBanner connected={false} />)
    // Test setup defaults to 'zh' locale
    expect(screen.getByText(/WebSocket 连接断开/)).toBeDefined()
  })

  it('has fixed positioning and z-50 for visibility', () => {
    render(<ConnectionBanner connected={false} />)
    const banner = screen.getByText(/WebSocket 连接断开/).closest('div')!
    expect(banner.className).toContain('fixed')
    expect(banner.className).toContain('z-50')
  })
})

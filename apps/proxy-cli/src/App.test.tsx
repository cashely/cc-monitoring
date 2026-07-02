import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { App } from './App'

// Recharts needs ResizeObserver
global.ResizeObserver = vi.fn().mockImplementation(() => ({
  observe: vi.fn(),
  unobserve: vi.fn(),
  disconnect: vi.fn()
}))

// Mock API module so no real HTTP calls
vi.mock('./api', () => ({
  fetchStatus: vi.fn().mockResolvedValue({ status: 'stopped', cpu: 0, memory: 0, uptime: 0, restarts: 0 }),
  fetchStatusHistory: vi.fn().mockResolvedValue({ history: [] }),
  fetchRequests: vi.fn().mockResolvedValue({ requests: [] }),
  fetchStats: vi.fn().mockResolvedValue({ hourly: {}, daily: {}, lastUpdated: null }),
  fetchConfig: vi.fn().mockResolvedValue({
    config: {
      server: { port: 3000, host: 'localhost' },
      proxy: { target: 'https://example.com', changeOrigin: true },
      logging: { level: 'info', file: 'logs/proxy.log' }
    }
  }),
  saveConfig: vi.fn().mockResolvedValue({ success: true })
}))

// Mock WebSocket — no real connection in tests
vi.mock('./hooks/useWebSocketData', () => ({
  useWebSocketData: () => ({
    status: { status: 'stopped', cpu: 0, memory: 0, uptime: 0, restarts: 0 },
    history: [],
    requests: [],
    stats: { hourly: {}, daily: {}, lastUpdated: null },
    connectionState: 'connected',
    reconnect: vi.fn()
  })
}))

describe('App', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders the app header', () => {
    render(<App />)
    expect(screen.getByText('Claude 代理助手')).toBeTruthy()
  })

  it('renders ConnectionBanner, StatsBarChart, RequestHistory, and StatusPanel', () => {
    render(<App />)
    // StatsBarChart renders with toggle buttons
    expect(screen.getByText('时')).toBeTruthy()
    expect(screen.getByText('天')).toBeTruthy()
    // RequestHistory renders empty state
    expect(screen.getByText('暂无请求')).toBeTruthy()
  })

  it('does not show disconnected banner when connected', () => {
    render(<App />)
    // ConnectionBanner returns null when connected
    expect(screen.queryByText('WebSocket 连接断开,请刷新页面重新连接')).toBeNull()
  })
})

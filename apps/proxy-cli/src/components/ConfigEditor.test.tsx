import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { ConfigEditor } from './ConfigEditor'

const mockFetchConfig = vi.fn().mockResolvedValue({
  config: {
    server: { port: 3000, host: 'localhost' },
    proxy: { target: 'https://example.com', changeOrigin: true },
    logging: { level: 'info', file: 'logs/proxy.log' }
  },
  versions: {},
  configPath: '/Users/test/.cc-monitoring/config.json'
})

const mockSyncClaudeSettings = vi.fn().mockResolvedValue({
  success: true,
  message: '同步成功'
})

vi.mock('../api', () => ({
  fetchConfig: (...args: any[]) => mockFetchConfig(...args),
  syncClaudeSettings: (...args: any[]) => mockSyncClaudeSettings(...args)
}))

describe('ConfigEditor', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFetchConfig.mockResolvedValue({
      config: {
        server: { port: 3000, host: 'localhost' },
        proxy: { target: 'https://example.com', changeOrigin: true },
        logging: { level: 'info', file: 'logs/proxy.log' }
      },
      versions: {},
      configPath: '/Users/test/.cc-monitoring/config.json'
    })
    mockSyncClaudeSettings.mockResolvedValue({ success: true, message: '同步成功' })
  })

  it('renders the heading', () => {
    render(<ConfigEditor />)
    expect(screen.getByText('服务器')).toBeDefined()
  })

  it('renders Server section', () => {
    render(<ConfigEditor />)
    expect(screen.getByText('服务器')).toBeDefined()
  })

  it('renders address card', () => {
    render(<ConfigEditor />)
    expect(screen.getByText('服务地址')).toBeDefined()
    expect(screen.getByText('http://localhost:9527')).toBeDefined()
  })

  it('renders config path card', async () => {
    // fetchConfig 不返回 configPath 时展示默认路径
    mockFetchConfig.mockResolvedValue({ config: {}, versions: {} })
    render(<ConfigEditor />)
    expect(screen.getByText('配置路径')).toBeDefined()
    await waitFor(() => expect(screen.getByText('~/.cc-monitoring')).toBeDefined())
  })

  it('renders sync button', () => {
    render(<ConfigEditor />)
    expect(screen.getByRole('button')).toBeDefined()
  })

  it('loads config from API on mount', async () => {
    render(<ConfigEditor />)
    await waitFor(() => expect(mockFetchConfig).toHaveBeenCalled())
  })

  it('shows success message after sync', async () => {
    render(<ConfigEditor />)
    fireEvent.click(screen.getByRole('button'))
    await waitFor(() => expect(screen.getByText('同步成功')).toBeDefined())
  })

  it('shows error message when sync fails', async () => {
    mockSyncClaudeSettings.mockResolvedValueOnce({
      success: false,
      message: '同步失败'
    })

    render(<ConfigEditor />)
    fireEvent.click(screen.getByRole('button'))

    await waitFor(() => {
      const msg = screen.getByText('同步失败')
      expect(msg).toBeDefined()
      expect(msg.className).toContain('text-error')
    })
  })

  it('displays configPath fetched from API', async () => {
    render(<ConfigEditor />)
    // configPath 去掉末尾 /config.json 后展示
    await waitFor(() => expect(screen.getByText('/Users/test/.cc-monitoring')).toBeDefined())
  })
})

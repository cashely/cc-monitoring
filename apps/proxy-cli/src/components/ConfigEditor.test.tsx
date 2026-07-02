import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { ConfigEditor } from './ConfigEditor'

const mockFetchConfig = vi.fn().mockResolvedValue({
  config: {
    server: { port: 3000, host: 'localhost' },
    proxy: { target: 'https://example.com', changeOrigin: true },
    logging: { level: 'info', file: 'logs/proxy.log' }
  }
})

const mockSaveConfig = vi.fn().mockResolvedValue({ success: true })

vi.mock('../api', () => ({
  fetchConfig: (...args: any[]) => mockFetchConfig(...args),
  saveConfig: (...args: any[]) => mockSaveConfig(...args)
}))

describe('ConfigEditor', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders the heading', () => {
    render(<ConfigEditor />)
    expect(screen.getByText('配置')).toBeDefined()
  })

  it('renders Server section', () => {
    render(<ConfigEditor />)
    expect(screen.getByText('服务器')).toBeDefined()
  })

  it('renders Proxy section', () => {
    render(<ConfigEditor />)
    expect(screen.getByText('代理')).toBeDefined()
  })

  it('renders Logging section', () => {
    render(<ConfigEditor />)
    expect(screen.getByText('日志')).toBeDefined()
  })

  it('renders Save and Reset buttons', () => {
    render(<ConfigEditor />)
    expect(screen.getByText('保存')).toBeDefined()
    expect(screen.getByText('重置默认')).toBeDefined()
  })

  it('loads config from API on mount', async () => {
    render(<ConfigEditor />)
    await waitFor(() => expect(mockFetchConfig).toHaveBeenCalled())
  })

  it('shows success message on save', async () => {
    render(<ConfigEditor />)
    fireEvent.click(screen.getByText('保存'))
    await waitFor(() => expect(screen.getByText('配置保存成功')).toBeDefined())
  })

  it('shows validation errors on failed save', async () => {
    mockSaveConfig.mockResolvedValueOnce({
      success: false,
      errors: [{ field: 'server.port', message: 'Port must be 1-65535' }]
    })

    render(<ConfigEditor />)
    fireEvent.click(screen.getByText('保存'))
    await waitFor(() => expect(screen.getByText('server.port: Port must be 1-65535')).toBeDefined())
  })

  it('resets to defaults on Reset click', async () => {
    render(<ConfigEditor />)
    await waitFor(() => expect(screen.getByDisplayValue('https://example.com')).toBeDefined())

    fireEvent.click(screen.getByText('重置默认'))

    await waitFor(() => {
      expect(screen.getByDisplayValue('https://token-plan.cn-beijing.maas.aliyuncs.com/apps/anthropic')).toBeDefined()
    })
  })
})

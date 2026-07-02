import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { StatusPanel } from './StatusPanel'
import type { StatusApiResponse, StatusDataPoint } from '../types'

// Mock recharts (heavy dependency, not needed for prop-based tests)
vi.mock('recharts', () => ({
  LineChart: () => null,
  Line: () => null,
  XAxis: () => null,
  YAxis: () => null,
  Tooltip: () => null,
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => children,
}))

vi.mock('./chart-theme', () => ({
  DARK_CHART_THEME: {
    axisColor: '#666',
    axisTickColor: '#999',
    tooltipBg: '#1a1a2e',
    tooltipBorder: '#444',
    tooltipText: '#fff',
  },
}))

const mockHistory: StatusDataPoint[] = [
  { timestamp: 1000, cpu: 30, memory: 52428800 },
  { timestamp: 2000, cpu: 45, memory: 104857600 },
]

const mockStatus: StatusApiResponse & { history?: StatusDataPoint[] } = {
  status: 'online',
  cpu: 45.2,
  memory: 104857600,
  uptime: 30000,
  restarts: 2,
  history: mockHistory,
}

describe('StatusPanel', () => {
  it('renders CPU chart section', () => {
    render(<StatusPanel status={mockStatus} />)
    expect(screen.getByText('CPU 使用率趋势')).toBeDefined()
  })

  it('renders Memory chart section', () => {
    render(<StatusPanel status={mockStatus} />)
    expect(screen.getByText('内存使用趋势')).toBeDefined()
  })

  it('handles empty history gracefully', () => {
    const noHistoryStatus: StatusApiResponse & { history?: StatusDataPoint[] } = {
      status: 'online',
      cpu: 0,
      memory: 0,
      uptime: 0,
      restarts: 0,
    }
    render(<StatusPanel status={noHistoryStatus} />)
    expect(screen.getByText('CPU 使用率趋势')).toBeDefined()
  })

  it('handles undefined history gracefully', () => {
    const undefinedHistoryStatus: StatusApiResponse & { history?: StatusDataPoint[] } = {
      status: 'online',
      cpu: 0,
      memory: 0,
      uptime: 0,
      restarts: 0,
      history: undefined,
    }
    render(<StatusPanel status={undefinedHistoryStatus} />)
    expect(screen.getByText('CPU 使用率趋势')).toBeDefined()
  })
})

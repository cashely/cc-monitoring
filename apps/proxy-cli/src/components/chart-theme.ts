/**
 * Glassmorphism Chart Theme
 * Color palette matching the SaaS dashboard design
 */

export const DARK_CHART_THEME = {
  axisColor: '#94A3B8',
  axisTickColor: '#94A3B8',
  gridColor: 'rgba(148, 163, 184, 0.15)',
  tooltipBg: 'rgba(15, 23, 42, 0.95)',
  tooltipBorder: 'rgba(148, 163, 184, 0.3)',
  tooltipText: '#F8FAFC',
} as const

export const LIGHT_CHART_THEME = {
  axisColor: '#64748B',
  axisTickColor: '#64748B',
  gridColor: 'rgba(148, 163, 184, 0.2)',
  tooltipBg: 'rgba(255, 255, 255, 0.95)',
  tooltipBorder: 'rgba(148, 163, 184, 0.4)',
  tooltipText: '#020617',
} as const

export const TOKEN_COLORS = {
  input: '#3B82F6',
  output: '#10B981',
  cacheRead: '#D97706',
  cacheCreate: '#06B6D4',
} as const

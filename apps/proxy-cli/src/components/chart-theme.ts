/**
 * 图表科技蓝主题配置
 * 色值匹配科技蓝配色方案，保持视觉一致性
 */

export const DARK_CHART_THEME = {
  axisColor: '#94A3B8',        // 轴线颜色 - 三级文字
  axisTickColor: '#94A3B8',    // 轴刻度文字 - 三级文字
  gridColor: '#475569',        // 网格线 - 边框色
  tooltipBg: '#111827',        // Tooltip 背景 - 次背景
  tooltipBorder: '#475569',    // Tooltip 边框 - 边框色
  tooltipText: '#F8FAFC',      // Tooltip 文字 - 一级文字
} as const

export const TOKEN_COLORS = {
  input: '#3B82F6',            // 蓝 - Primary 品牌
  output: '#10B981',           // 绿 - Success 状态
  cacheRead: '#F59E0B',        // 橙 - Warning 状态
  cacheCreate: '#06B6D4',      // 青蓝 - Info 状态
} as const
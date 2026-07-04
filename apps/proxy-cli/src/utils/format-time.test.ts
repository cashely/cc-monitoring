import { describe, it, expect } from 'vitest'
import { formatTime } from './format-time'

describe('formatTime', () => {
  it('空值 / 非法输入返回 --', () => {
    expect(formatTime(null)).toBe('--')
    expect(formatTime(undefined)).toBe('--')
    expect(formatTime('')).toBe('--')
    expect(formatTime('not-a-date')).toBe('--')
  })

  it('接受 ISO 字符串与数字时间戳', () => {
    const iso = '2025-01-01T00:00:00Z'
    const ts = new Date(iso).getTime()
    // 同一时刻的字符串与时间戳应格式化为相同结果
    expect(formatTime(iso, 'date')).toBe(formatTime(ts, 'date'))
  })

  it('不同 format 产出不同粒度', () => {
    const iso = '2025-06-15T13:45:30Z'
    const time = formatTime(iso, 'time')
    const date = formatTime(iso, 'date')
    const monthDayTime = formatTime(iso, 'monthDayTime')

    // time 只含时分（无年份）
    expect(time).not.toContain('2025')
    // date 含年份、不含冒号（无时间）
    expect(date).toContain('2025')
    expect(date).not.toContain(':')
    // monthDayTime 含时间冒号、不含年份
    expect(monthDayTime).toContain(':')
    expect(monthDayTime).not.toContain('2025')
  })
})

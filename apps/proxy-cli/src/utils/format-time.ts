export type TimeFormat = 'datetime' | 'date' | 'time' | 'monthDayTime'

const LOCALE = 'zh-CN'

// 各格式对应的 Intl 选项（按浏览器本地时区显示）
const FORMAT_OPTIONS: Record<TimeFormat, Intl.DateTimeFormatOptions | undefined> = {
  // 完整日期 + 时分秒（默认，等价于 toLocaleString()）
  datetime: undefined,
  // 仅日期
  date: { year: 'numeric', month: '2-digit', day: '2-digit' },
  // 仅时分
  time: { hour: '2-digit', minute: '2-digit' },
  // 月日 + 时分秒
  monthDayTime: {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  },
}

/**
 * 统一时间格式化：输入 ISO 字符串或时间戳（number），按浏览器本地时区显示。
 * 空值或非法输入返回 '--'。
 */
export function formatTime(input: string | number | null | undefined, format: TimeFormat = 'datetime'): string {
  if (input === null || input === undefined || input === '') return '--'

  const date = new Date(input)
  if (Number.isNaN(date.getTime())) return '--'

  const options = FORMAT_OPTIONS[format]
  return options ? date.toLocaleString(LOCALE, options) : date.toLocaleString(LOCALE)
}

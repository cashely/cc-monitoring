const COMPACT_FORMATTER = Intl.NumberFormat('en-US', {
  notation: 'compact',
  compactDisplay: 'short'
})

/**
 * Format number with compact notation (1.2K, 1M, 1.5B)
 */
export function formatCompactNumber(num: number): string {
  return COMPACT_FORMATTER.format(num)
}

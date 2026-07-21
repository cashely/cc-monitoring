/**
 * Status History Store - 时间序列数据存储
 * 用于记录最近一小时的 CPU/内存指标，供趋势图使用
 */

export interface StatusDataPoint {
  timestamp: number  // Unix ms
  cpu: number        // 百分比
  memory: number     // bytes
}

export interface StatusHistoryResponse {
  history: StatusDataPoint[]
}

export class StatusHistoryStore {
  private data: StatusDataPoint[] = []
  private maxPoints: number = 720  // 1小时 * 60分 * 12采样/分 (5s间隔)

  push(point: StatusDataPoint): void {
    this.data.push(point)
    // 超出容量时，丢弃最旧数据（shift 不创建新数组）
    while (this.data.length > this.maxPoints) {
      this.data.shift()
    }
  }

  getHistory(durationMs: number = 3600000): StatusDataPoint[] {
    const cutoff = Date.now() - durationMs
    return this.data.filter(p => p.timestamp >= cutoff)
  }
}

// 模块级单例
export const statusHistory = new StatusHistoryStore()
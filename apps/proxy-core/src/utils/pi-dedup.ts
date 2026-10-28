// learn 主题去重：纯字符串确定性预筛（不调 LLM、无 IO）

// 与 knowledge-store 的 TopicSummary 结构一致；此处复制最小类型，避免导入单例
export interface TopicSummary { slug: string; title: string; summary: string; tags: string[] }

// 归一化：小写；非字母数字字符（含 -、_、! 等标点）统一替换为空格；trim 并压缩连续空白
// 标点替换为空格而非删除，使 state-management 与 State Management 归一后一致
export function normalizeText(s: string): string {
  return s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
}

// 命中信号强度：归一 title 相等(0) > 任一归一 tag 相等(1) > title 互为子串(2)
export function findCandidates(
  cand: { title: string; tags: string[] },
  topics: TopicSummary[],
): TopicSummary[] {
  const candTitle = normalizeText(cand.title)
  const candTags = new Set(cand.tags.map(normalizeText).filter(Boolean))
  // slug -> 命中的 topic 及其最强信号；按 slug 去重
  const hits = new Map<string, { topic: TopicSummary; rank: number }>()

  for (const topic of topics) {
    const topicTitle = normalizeText(topic.title)
    let rank = -1
    if (candTitle && topicTitle === candTitle) {
      rank = 0
    } else if (topic.tags.some(t => candTags.has(normalizeText(t)))) {
      rank = 1
    } else if (candTitle && topicTitle && (topicTitle.includes(candTitle) || candTitle.includes(topicTitle))) {
      rank = 2
    }
    if (rank === -1) continue
    const prev = hits.get(topic.slug)
    if (!prev || rank < prev.rank) hits.set(topic.slug, { topic, rank })
  }

  // sort 稳定，同强度保持 topics 原始顺序
  return [...hits.values()].sort((a, b) => a.rank - b.rank).map(h => h.topic)
}

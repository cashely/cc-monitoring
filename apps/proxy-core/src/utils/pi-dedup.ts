// learn 主题去重：纯字符串确定性预筛（不调 LLM、无 IO）
import { readFile } from 'fs/promises'
import path from 'path'
import { runJsonPrompt } from './pi-runtime.js'

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

// ---- LLM 兜底裁定 ----

// 大纲条目（与 knowledge-store 结构一致，本地复制避免循环依赖）
export interface OutlineItem { id: string; title: string; oneLine: string }
export interface ChunkRefLike { id: string; title: string; summary: string; tags: string[] }
export interface TopicIndexLike { slug: string; title: string; summary: string; tags: string[]; chunks: ChunkRefLike[] }
export interface ReconcileResult {
  match: boolean
  targetSlug?: string
  confidence?: number
  mergedTitle?: string
  mergedSummary?: string
  itemsToAdd?: OutlineItem[]
}

// 预筛无命中时允许全量送 LLM 的目标上限；超过则安全放弃
export const LLM_FULL_SCAN_MAX = 20

// 读全部 topic 摘要；index.json 缺失/损坏等任何异常一律返回 []
export async function readAllTopics(docsDir: string): Promise<TopicSummary[]> {
  try {
    const raw = await readFile(path.join(docsDir, 'index.json'), 'utf8')
    const data = JSON.parse(raw)
    return Array.isArray(data.topics) ? data.topics : []
  } catch {
    return []
  }
}

// 读单个 topic 详情；缺失/异常返回 null
export async function readTopicDetail(docsDir: string, slug: string): Promise<TopicIndexLike | null> {
  try {
    const raw = await readFile(path.join(docsDir, slug, 'index.json'), 'utf8')
    return JSON.parse(raw) as TopicIndexLike
  } catch {
    return null
  }
}

// LLM 兜底：在确定性预筛无法排除重复时，请模型裁定候选是否应并入某已有 topic。
// 任何失败（IO、坏 JSON、超限）均安全降级为 { match: false }
export async function reconcileTopics(opts: {
  port: number
  docsDir: string
  candidate: { slug: string; title: string; tags: string[]; items?: OutlineItem[] }
  targets?: Array<TopicSummary & { chunks?: ChunkRefLike[] }>
  wantItems: boolean
}): Promise<ReconcileResult> {
  const targets = opts.targets
    ?? (await readAllTopics(opts.docsDir)).filter(t => t.slug !== opts.candidate.slug)

  // 先走确定性预筛；无命中且目标数在上限内才全量送 LLM，超限直接放弃
  const hits = findCandidates({ title: opts.candidate.title, tags: opts.candidate.tags }, targets)
  let chosen: typeof targets
  if (hits.length > 0) {
    chosen = hits
  } else if (targets.length <= LLM_FULL_SCAN_MAX) {
    chosen = targets
  } else {
    return { match: false }
  }

  const instructions = [
    '你是主题去重裁定器。判断「新主题」与候选已有主题之间是否存在实质内容重叠。',
    '判定从宽：只要主题域/核心问题实质重合就应判为重复，宁可合并，不要因措辞或粒度不同而漏判。',
    '存在多个可能目标时，只选最匹配的一个，把它的 slug 填入 targetSlug。',
    '判为重复时必须给出 mergedTitle（合并后的主题标题）与 mergedSummary（合并后的摘要）。',
    opts.wantItems
      ? '同时给出 itemsToAdd：仅包含目标主题现有 chunks 尚未覆盖的、需要新增的大纲条目；已覆盖的条目不要放入。'
      : '不要输出 itemsToAdd。',
    '只返回一个 JSON 对象，不要输出任何解释或多余文本。',
    '格式：{"match":boolean,"targetSlug":string,"confidence":number,"mergedTitle":string,"mergedSummary":string'
      + (opts.wantItems ? ',"itemsToAdd":[{"id":string,"title":string,"oneLine":string}]' : '')
      + '}',
  ].join('\n')

  const prompt = `新主题：\n${JSON.stringify(opts.candidate)}\n\n候选已有主题：\n${JSON.stringify(chosen)}`

  try {
    const result = await runJsonPrompt({ port: opts.port, instructions, prompt }) as ReconcileResult
    if (result && result.match === true) return result
    return { match: false }
  } catch {
    return { match: false }
  }
}

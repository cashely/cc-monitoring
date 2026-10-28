// learn 主题去重：纯字符串确定性预筛（不调 LLM、无 IO）
import { readFile } from 'fs/promises'
import fs from 'node:fs'
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

// ---- 物理迁移：把 src 主题的 sources/chunks 统一并入 dst ----

// 3 位补零编号，与 orchestrator 落盘约定一致
function pad3(n: number): string {
  return String(n).padStart(3, '0')
}

// 列出 dir 下的 .md 文件名（排序）；目录缺失视为空
function listMd(dir: string): string[] {
  try {
    return fs.readdirSync(dir).filter(f => f.endsWith('.md')).sort()
  } catch {
    return []
  }
}

// 将 src 主题物理并入 dst：sources 续号拷贝、chunks 按 dst 现有数偏移重编号，
// 同步更新 dst index 与根 index，最后删除整个 src 目录。返回迁移后 dst 的 chunk 总数。
// srcSlug 可能是 x.old 旁挂目录（含点，路径直接拼接）。
export function mergeTopics(docsDir: string, srcSlug: string, dstSlug: string): number {
  const srcDir = path.join(docsDir, srcSlug)
  const dstDir = path.join(docsDir, dstSlug)

  // dst index 必须存在，缺失直接抛错；src index 同样读取（路径直接拼，支持 x.old）
  const dstIndex = JSON.parse(fs.readFileSync(path.join(dstDir, 'index.json'), 'utf8')) as TopicIndexLike
  const srcIndex = JSON.parse(fs.readFileSync(path.join(srcDir, 'index.json'), 'utf8')) as TopicIndexLike

  // sources：按 dst 现有数量续号，逐个读→写 dst→删 src 原件（copy→unlink，避免跨设备 rename 失败）
  const srcSources = listMd(path.join(srcDir, 'sources'))
  const s0 = listMd(path.join(dstDir, 'sources')).length
  fs.mkdirSync(path.join(dstDir, 'sources'), { recursive: true })
  srcSources.forEach((file, i) => {
    const body = fs.readFileSync(path.join(srcDir, 'sources', file))
    fs.writeFileSync(path.join(dstDir, 'sources', `source-${pad3(s0 + i + 1)}.md`), body)
    fs.unlinkSync(path.join(srcDir, 'sources', file))
  })

  // chunks：src refs 按 id 排序，按 dst 现有 chunk 数偏移重编号；正文逐字拷贝不改
  const srcRefs = [...srcIndex.chunks].sort((a, b) => a.id.localeCompare(b.id))
  const k = dstIndex.chunks.length
  fs.mkdirSync(path.join(dstDir, 'chunks'), { recursive: true })
  srcRefs.forEach((ref, i) => {
    const newId = `chunk-${pad3(k + i + 1)}`
    const body = fs.readFileSync(path.join(srcDir, 'chunks', `${ref.id}.md`))
    fs.writeFileSync(path.join(dstDir, 'chunks', `${newId}.md`), body)
    fs.unlinkSync(path.join(srcDir, 'chunks', `${ref.id}.md`))
    dstIndex.chunks.push({ ...ref, id: newId })
  })

  // 根 index：移除 slug===srcSlug 的条目（srcSlug 为 x.old 时不命中即 no-op）
  try {
    const rootPath = path.join(docsDir, 'index.json')
    const root = JSON.parse(fs.readFileSync(rootPath, 'utf8')) as { topics: TopicSummary[] }
    if (Array.isArray(root.topics)) {
      root.topics = root.topics.filter(t => t.slug !== srcSlug)
      fs.writeFileSync(rootPath, JSON.stringify(root, null, 2))
    }
  } catch {
    // 根 index 缺失/损坏：无条目可移除，跳过
  }

  // 删除整个 src 目录，写回 dst index
  fs.rmSync(srcDir, { recursive: true, force: true })
  fs.writeFileSync(path.join(dstDir, 'index.json'), JSON.stringify(dstIndex, null, 2))
  return dstIndex.chunks.length
}

// 阻断：docsDir 下存在任何 .old 旁挂目录时抛错，要求人工先处理。
// docsDir 本身缺失时直接让 readdirSync 抛错（调用方本就应在已初始化的库上学习）。
export function assertNoOldDirs(docsDir: string): void {
  const oldDir = fs.readdirSync(docsDir).find(name => name.endsWith('.old'))
  if (oldDir) {
    throw new Error(`检测到未清理的旁挂目录 ${oldDir}，请手工处理后再学习`)
  }
}

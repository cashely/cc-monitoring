import { promises as fs } from 'node:fs'
import path from 'node:path'
import { dataDir } from './paths.js'

const docsDir = path.join(dataDir, 'docs')

const TOPIC_RE = /^[a-z0-9][a-z0-9-]*$/
const CHUNK_RE = /^chunk-\d{3}$/

export interface TopicSummary { slug: string; title: string; summary: string; tags: string[] }
export interface ChunkRef { id: string; title: string; summary: string; tags: string[] }
export interface TopicDetail { title: string; tags: string[]; sources: unknown[]; chunks: ChunkRef[] }
export interface ChunkHit { topic: string; chunkId: string; title: string }
export interface QueryHit { topic: string; chunkId: string; title: string; body: string }

interface RootIndex { topics: TopicSummary[] }
interface TopicIndex { slug: string; title: string; summary: string; tags: string[]; chunks: ChunkRef[] }

export interface KnowledgeStore {
  listTopics(): Promise<TopicSummary[]>
  getTopic(topic: string): Promise<TopicDetail>
  searchChunks(query: string): Promise<ChunkHit[]>
  queryKnowledge(query: string, limit?: number): Promise<QueryHit[]>
  readChunk(topic: string, chunkId: string): Promise<string>
  upsertTopic(input: { slug: string; title: string; summary: string; tags: string[] }): Promise<void>
  upsertChunkRef(input: { topic: string; chunkId: string; title: string; summary: string; tags: string[] }): Promise<void>
}

function assertTopic(topic: string): void {
  if (!TOPIC_RE.test(topic)) {
    throw new Error(`invalid topic slug: ${topic}`)
  }
}

function assertChunkId(chunkId: string): void {
  if (!CHUNK_RE.test(chunkId)) {
    throw new Error(`invalid chunk id: ${chunkId} (expect chunk-NNN)`)
  }
}

/** 从 chunk 正文首行 `# xxx` 提取 title（用于 searchChunks） */
function parseChunkTitle(text: string): string {
  const m = text.match(/^#\s+(.+?)\s*$/m)
  return m ? m[1].trim() : ''
}

/** 读 JSON 文件，不存在或解析失败时返回 fallback */
async function readJsonOr<T>(file: string, fallback: T): Promise<T> {
  try {
    const text = await fs.readFile(file, 'utf8')
    return JSON.parse(text) as T
  } catch {
    return fallback
  }
}

export function createKnowledgeStore(root: string): KnowledgeStore {
  async function listTopics(): Promise<TopicSummary[]> {
    const indexPath = path.join(root, 'index.json')
    const parsed = await readJsonOr<RootIndex>(indexPath, { topics: [] })
    return Array.isArray(parsed.topics) ? parsed.topics : []
  }

  async function getTopic(topic: string): Promise<TopicDetail> {
    assertTopic(topic)
    const indexPath = path.join(root, topic, 'index.json')
    let meta: TopicIndex
    try {
      const text = await fs.readFile(indexPath, 'utf8')
      meta = JSON.parse(text) as TopicIndex
    } catch (e: any) {
      if (e && e.code === 'ENOENT') {
        throw new Error(`topic not found: ${topic}`)
      }
      throw new Error(`topic index corrupt: ${topic}, fix or delete ${topic}/index.json`)
    }
    return {
      title: meta.title || topic,
      tags: Array.isArray(meta.tags) ? meta.tags : [],
      sources: [],
      chunks: Array.isArray(meta.chunks)
        ? meta.chunks.map(c => ({
            id: c.id,
            title: c.title,
            summary: c.summary,
            tags: Array.isArray(c.tags) ? c.tags : [],
          }))
        : [],
    }
  }

  async function upsertTopic(input: { slug: string; title: string; summary: string; tags: string[] }): Promise<void> {
    assertTopic(input.slug)
    const { slug, title, summary, tags } = input

    // 1. 更新根 index.json
    const rootPath = path.join(root, 'index.json')
    const rootIdx = await readJsonOr<RootIndex>(rootPath, { topics: [] })
    if (!Array.isArray(rootIdx.topics)) rootIdx.topics = []
    const existingRoot = rootIdx.topics.find(t => t.slug === slug)
    if (existingRoot) {
      existingRoot.title = title
      existingRoot.summary = summary
      existingRoot.tags = tags
    } else {
      rootIdx.topics.push({ slug, title, summary, tags })
    }
    await fs.writeFile(rootPath, JSON.stringify(rootIdx, null, 2), 'utf8')

    // 2. 更新主题 index.json（不动 chunks 数组）
    const topicDir = path.join(root, slug)
    const topicPath = path.join(topicDir, 'index.json')
    const topicIdx = await readJsonOr<TopicIndex>(topicPath, { slug, title, summary, tags, chunks: [] })
    topicIdx.slug = slug
    topicIdx.title = title
    topicIdx.summary = summary
    topicIdx.tags = tags
    if (!Array.isArray(topicIdx.chunks)) topicIdx.chunks = []
    await fs.mkdir(topicDir, { recursive: true })
    await fs.writeFile(topicPath, JSON.stringify(topicIdx, null, 2), 'utf8')
  }

  async function upsertChunkRef(input: { topic: string; chunkId: string; title: string; summary: string; tags: string[] }): Promise<void> {
    assertTopic(input.topic)
    assertChunkId(input.chunkId)
    const { topic, chunkId, title, summary, tags } = input
    const topicPath = path.join(root, topic, 'index.json')
    let topicIdx: TopicIndex
    try {
      const text = await fs.readFile(topicPath, 'utf8')
      topicIdx = JSON.parse(text) as TopicIndex
    } catch (e: any) {
      if (e && e.code === 'ENOENT') {
        throw new Error(`topic not found: ${topic}, call add_topic first`)
      }
      throw e
    }
    if (!Array.isArray(topicIdx.chunks)) topicIdx.chunks = []
    const existing = topicIdx.chunks.find(c => c.id === chunkId)
    if (existing) {
      existing.title = title
      existing.summary = summary
      existing.tags = tags
    } else {
      topicIdx.chunks.push({ id: chunkId, title, summary, tags })
    }
    await fs.writeFile(topicPath, JSON.stringify(topicIdx, null, 2), 'utf8')
  }

  /** 匹配词集合：整体 query + whitespace 分割的长度 >1 的 token，去重 */
  function buildTerms(query: string): string[] {
    const q = query.toLowerCase()
    const terms = new Set<string>([q])
    for (const tok of q.split(/\s+/)) {
      if (tok.length > 1) terms.add(tok)
    }
    return [...terms]
  }

  interface ScannedChunk {
    topic: string
    chunkId: string
    title: string
    score: number
    /** 按旧 searchChunks 规则（仅整体 query）是否命中 */
    wholeQueryHit: boolean
  }

  /** 扫描所有 topic/chunk，返回打分候选（searchChunks / queryKnowledge 共用） */
  async function scanChunks(query: string): Promise<ScannedChunk[]> {
    const q = query.toLowerCase()
    if (!q.trim()) return []
    const terms = buildTerms(query)
    const candidates: ScannedChunk[] = []
    // topic index 本函数作用域缓存，避免每个 chunk 重复读
    const topicIndexCache = new Map<string, TopicIndex | null>()
    let entries: string[]
    try {
      entries = await fs.readdir(root)
    } catch {
      return []
    }
    for (const topic of entries) {
      if (!TOPIC_RE.test(topic)) continue
      if (!topicIndexCache.has(topic)) {
        const idx = await readJsonOr<TopicIndex | null>(path.join(root, topic, 'index.json'), null)
        topicIndexCache.set(topic, idx)
      }
      const topicIdx = topicIndexCache.get(topic) ?? null
      const topicTags = topicIdx && Array.isArray(topicIdx.tags) ? topicIdx.tags : []
      const chunkRefs = topicIdx && Array.isArray(topicIdx.chunks) ? topicIdx.chunks : []
      const topicTagHit = (term: string) => topicTags.some(t => t.toLowerCase().includes(term))

      const chunksDir = path.join(root, topic, 'chunks')
      let files: string[]
      try {
        files = await fs.readdir(chunksDir)
      } catch {
        continue
      }
      for (const file of files) {
        const chunkId = file.replace(/\.md$/, '')
        if (!CHUNK_RE.test(chunkId)) continue
        const text = await fs.readFile(path.join(chunksDir, file), 'utf8')
        const textLc = text.toLowerCase()
        const ref = chunkRefs.find(c => c.id === chunkId)
        const refTitle = (ref?.title ?? '').toLowerCase()
        const refSummary = (ref?.summary ?? '').toLowerCase()
        const refTags = ref && Array.isArray(ref.tags) ? ref.tags : []

        let score = 0
        for (const term of terms) {
          // 每个字段每词只计一次分，body 不按出现次数刷分
          if (refTitle.includes(term)) score += 3
          if (refTags.some(t => t.toLowerCase().includes(term))) score += 2
          if (topicTagHit(term)) score += 2
          if (refSummary.includes(term)) score += 1
          if (textLc.includes(term)) score += 1
        }
        if (score === 0) continue
        const wholeQueryHit =
          textLc.includes(q) ||
          refTitle.includes(q) ||
          refSummary.includes(q) ||
          topicTagHit(q) ||
          refTags.some(t => t.toLowerCase().includes(q))
        candidates.push({ topic, chunkId, title: parseChunkTitle(text), score, wholeQueryHit })
      }
    }
    return candidates
  }

  async function searchChunks(query: string): Promise<ChunkHit[]> {
    if (!query.trim()) return []
    return (await scanChunks(query))
      .filter(c => c.wholeQueryHit)
      .map(({ topic, chunkId, title }) => ({ topic, chunkId, title }))
  }

  async function queryKnowledge(query: string, limit = 3): Promise<QueryHit[]> {
    const capped = Math.min(Math.max(limit, 1), 5)
    const candidates = (await scanChunks(query))
      .sort((a, b) => b.score - a.score)
      .slice(0, capped)
    const hits: QueryHit[] = []
    for (const c of candidates) {
      const body = await readChunk(c.topic, c.chunkId)
      hits.push({ topic: c.topic, chunkId: c.chunkId, title: c.title, body })
    }
    return hits
  }

  async function readChunk(topic: string, chunkId: string): Promise<string> {
    assertTopic(topic)
    assertChunkId(chunkId)
    const filePath = path.join(root, topic, 'chunks', `${chunkId}.md`)
    // 二次校验：解析后路径必须在 root/<topic>/chunks/ 内
    const resolved = path.resolve(filePath)
    const expectedDir = path.resolve(root, topic, 'chunks')
    if (!resolved.startsWith(expectedDir + path.sep)) {
      throw new Error('access denied: chunk path escapes chunks dir')
    }
    return fs.readFile(resolved, 'utf8')
  }

  return { listTopics, getTopic, searchChunks, queryKnowledge, readChunk, upsertTopic, upsertChunkRef }
}

// 默认单例：绑生产 docsDir
export const knowledgeStore = createKnowledgeStore(docsDir)

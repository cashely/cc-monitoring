import { promises as fs } from 'node:fs'
import path from 'node:path'
import { dataDir } from './paths.js'

const docsDir = path.join(dataDir, 'docs')

const TOPIC_RE = /^[a-z0-9][a-z0-9-]*$/
const CHUNK_RE = /^chunk-\d{3}$/

export interface TopicSummary { slug: string; title: string; summary: string }
export interface ChunkRef { id: string; title: string; summary: string }
export interface TopicDetail { title: string; tags: string[]; sources: unknown[]; chunks: ChunkRef[] }
export interface ChunkHit { topic: string; chunkId: string; title: string }

export interface KnowledgeStore {
  listTopics(): Promise<TopicSummary[]>
  getTopic(topic: string): Promise<TopicDetail>
  searchChunks(query: string): Promise<ChunkHit[]>
  readChunk(topic: string, chunkId: string): Promise<string>
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

/** 解析 "- <slug>: <摘要>" 行（自然 markdown 列表） */
function parseRootIndex(text: string): TopicSummary[] {
  const out: TopicSummary[] = []
  const re = /^- ([a-z0-9][a-z0-9-]*):\s*(.+?)\s*$/m
  for (const line of text.split('\n')) {
    const m = line.match(re)
    if (m) out.push({ slug: m[1], title: m[1], summary: m[2].trim() })
  }
  return out
}

/** 解析主题 INDEX.md 的 "## 元数据" 区块：`- 名称: xxx` / `- 标签: a, b, c` */
function parseTopicMeta(text: string): { title: string; tags: string[] } {
  let title = ''
  let tags: string[] = []
  const nameRe = /^- 名称:\s*(.+?)\s*$/m
  const tagsRe = /^- 标签:\s*(.+?)\s*$/m
  const nameM = text.match(nameRe)
  if (nameM) title = nameM[1].trim()
  const tagsM = text.match(tagsRe)
  if (tagsM) {
    tags = tagsM[1].split(',').map(s => s.trim()).filter(Boolean)
  }
  return { title, tags }
}

/** 解析片段清单行 "- chunk-NNN: <标题> — <描述>" 或 "- chunk-NNN: <描述>" */
function parseChunkList(text: string): ChunkRef[] {
  const out: ChunkRef[] = []
  const re = /^- (chunk-\d{3}):\s*(.+?)\s*$/m
  for (const line of text.split('\n')) {
    const m = line.match(re)
    if (!m) continue
    const rest = m[2].trim()
    const dashIdx = rest.indexOf(' — ')
    let title: string
    let summary: string
    if (dashIdx >= 0) {
      title = rest.slice(0, dashIdx).trim()
      summary = rest.slice(dashIdx + 3).trim()
    } else {
      title = rest
      summary = rest
    }
    out.push({ id: m[1], title, summary })
  }
  return out
}

/** 从 chunk 正文首行 `# xxx` 提取 title（用于 searchChunks） */
function parseChunkTitle(text: string): string {
  const m = text.match(/^#\s+(.+?)\s*$/m)
  return m ? m[1].trim() : ''
}

export function createKnowledgeStore(root: string): KnowledgeStore {
  async function listTopics(): Promise<TopicSummary[]> {
    const indexPath = path.join(root, 'INDEX.md')
    try {
      const text = await fs.readFile(indexPath, 'utf8')
      return parseRootIndex(text)
    } catch {
      return []
    }
  }

  async function getTopic(topic: string): Promise<TopicDetail> {
    assertTopic(topic)
    const indexPath = path.join(root, topic, 'INDEX.md')
    const text = await fs.readFile(indexPath, 'utf8')
    const meta = parseTopicMeta(text)
    return {
      title: meta.title || topic,
      tags: meta.tags,
      sources: [],
      chunks: parseChunkList(text),
    }
  }

  async function searchChunks(query: string): Promise<ChunkHit[]> {
    if (!query.trim()) return []
    const hits: ChunkHit[] = []
    const q = query.toLowerCase()
    let entries: string[]
    try {
      entries = await fs.readdir(root)
    } catch {
      return []
    }
    for (const topic of entries) {
      if (!TOPIC_RE.test(topic)) continue
      const chunksDir = path.join(root, topic, 'chunks')
      let files: string[]
      try {
        files = await fs.readdir(chunksDir)
      } catch {
        continue
      }
      for (const file of files) {
        if (!CHUNK_RE.test(file.replace(/\.md$/, ''))) continue
        const text = await fs.readFile(path.join(chunksDir, file), 'utf8')
        if (text.toLowerCase().includes(q)) {
          hits.push({ topic, chunkId: file.replace(/\.md$/, ''), title: parseChunkTitle(text) })
        }
      }
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

  return { listTopics, getTopic, searchChunks, readChunk }
}

// 默认单例：绑生产 docsDir
export const knowledgeStore = createKnowledgeStore(docsDir)

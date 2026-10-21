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

/** 解析 "- [slug](slug/) — 摘要" 行 */
function parseRootIndex(text: string): TopicSummary[] {
  const out: TopicSummary[] = []
  const re = /^- \[([a-z0-9-]+)\]\([a-z0-9-]+\/\)\s*[—-]\s*(.+)$/m
  for (const line of text.split('\n')) {
    const m = line.match(re)
    if (m) out.push({ slug: m[1], title: m[1], summary: m[2].trim() })
  }
  return out
}

/** 解析 frontmatter 里的 title / tags / sources */
function parseFrontmatter(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  const m = text.match(/^---\n([\s\S]*?)\n---/)
  if (!m) return out
  for (const line of m[1].split('\n')) {
    const kv = line.match(/^(\w+):\s*(.+)$/)
    if (kv) out[kv[1]] = kv[2].trim()
  }
  return out
}

/** 解析片段清单行 "- [chunk-NNN](chunks/chunk-NNN.md) — 描述" */
function parseChunkList(text: string): ChunkRef[] {
  const out: ChunkRef[] = []
  const re = /^- \[(chunk-\d{3})\]\(chunks\/chunk-\d{3}\.md\)\s*[—-]\s*(.+)$/m
  for (const line of text.split('\n')) {
    const m = line.match(re)
    if (m) out.push({ id: m[1], title: m[2].trim(), summary: m[2].trim() })
  }
  return out
}

/** 从 chunk 正文 frontmatter 提取 title（用于 searchChunks） */
function parseChunkTitle(text: string): string {
  const fm = parseFrontmatter(text)
  return fm.title ?? ''
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
    const fm = parseFrontmatter(text)
    return {
      title: fm.title ?? topic,
      tags: fm.tags ? fm.tags.replace(/[[\]]/g, '').split(',').map(s => s.trim()).filter(Boolean) : [],
      sources: [],
      chunks: parseChunkList(text),
    }
  }

  async function searchChunks(query: string): Promise<ChunkHit[]> {
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

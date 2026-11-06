// vault：learn 文件型知识库（~/.cc-monitoring/docs）的深 module。
// 物理布局：
// - index.json 根索引 {"topics":[TopicSummary]}
// - <slug>/index.json 主题索引 TopicIndex（元数据 + chunks 引用）
// - <slug>/outline.json、<slug>/sources/source-NNN.md、<slug>/chunks/chunk-NNN.md
// - <slug>.old/ 旁挂备份
// 所有路径解析、slug/chunk-id 校验、物理读写均以本 module 为唯一权威。

import { promises as fs } from 'node:fs'
import fsSync from 'node:fs'
import path from 'node:path'
import { dataDir } from './paths.js'

// 合法 slug：小写字母数字开头，仅含小写字母数字与连字符
const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/
const CHUNK_RE = /^chunk-\d{3}$/

export function isValidSlug(slug: string): boolean {
  return SLUG_RE.test(slug)
}

export interface TopicSummary { slug: string; title: string; summary: string; tags: string[] }
export interface ChunkRef { id: string; title: string; summary: string; tags: string[] }
export interface TopicIndex { slug: string; title: string; summary: string; tags: string[]; chunks: ChunkRef[] }
interface TopicDetail { title: string; tags: string[]; sources: unknown[]; chunks: ChunkRef[] }
interface ChunkHit { topic: string; chunkId: string; title: string }
interface QueryHit { topic: string; chunkId: string; title: string; body: string }
export interface OutlineItem { id: string; title: string; oneLine: string }

interface RootIndex { topics: TopicSummary[] }

export interface Vault {
  /** vault 根目录（docsDir）绝对路径 */
  readonly root: string
  // ---- 读 / 查（原 knowledge-store 能力，行为逐字保持）----
  listTopics(): Promise<TopicSummary[]>
  getTopic(topic: string): Promise<TopicDetail>
  searchChunks(query: string): Promise<ChunkHit[]>
  queryKnowledge(query: string, limit?: number): Promise<QueryHit[]>
  readChunk(topic: string, chunkId: string): Promise<string>
  upsertTopic(input: { slug: string; title: string; summary: string; tags: string[] }): Promise<void>
  upsertChunkRef(input: { topic: string; chunkId: string; title: string; summary: string; tags: string[] }): Promise<void>
  // ---- 主题索引（async；缺失/坏 → null）----
  readTopicIndex(slug: string): Promise<TopicIndex | null>
  readSidecarIndex(slug: string): Promise<TopicIndex | null>
  // ---- 物理操作（sync）----
  assertSlug(slug: string, field?: string): void
  /** 重建 topic 目录：rm -rf 后建 sources/ + chunks/ */
  prepareTopic(slug: string): void
  /** 写 <slug>/sources/source-NNN.md（content 带 Source 头） */
  writeSourceFile(slug: string, index: number, url: string, text: string): void
  /** 数 <slug>/sources 下 .md 文件；目录不存在按 0 */
  countSourceFiles(slug: string): number
  /** 读 <slug>/sources 下全部 .md 正文（按文件名排序）；目录缺失抛底层错误 */
  readSourceBodies(slug: string): string[]
  /** 写 <slug>/outline.json（校验目录已 prepare、sources 存在） */
  writeOutline(slug: string, items: OutlineItem[]): void
  /** 读 <slug>/outline.json 的 items；文件不存在抛「outline 未生成」 */
  readOutlineItems(slug: string): OutlineItem[]
  /** 旁挂：<slug> → <slug>.old */
  parkTopic(slug: string): void
  /** 还原：<slug>.old → <slug> */
  restoreTopic(slug: string): void
  /** 重命名 topic 目录：<slug> → <newSlug> */
  renameTopic(slug: string, newSlug: string): void
  /** 读 <entry>/index.json（entry 可为 slug 或 <slug>.old）；缺失/坏抛底层错误 */
  readEntryIndexSync(entry: string): TopicIndex
  /** 写 <entry>/index.json */
  writeEntryIndexSync(entry: string, idx: TopicIndex): void
  readRootIndexSync(): RootIndex
  writeRootIndexSync(root: RootIndex): void
  /** 列 <entry>/<subdir> 下 .md 文件名（排序）；目录缺失视为空 */
  listEntryMd(entry: string, subdir: 'sources' | 'chunks'): string[]
  mkdirEntrySubdir(entry: string, subdir: 'sources' | 'chunks'): void
  readEntryFile(entry: string, subdir: 'sources' | 'chunks', file: string): Buffer
  writeEntryFile(entry: string, subdir: 'sources' | 'chunks', file: string, body: Buffer): void
  unlinkEntryFile(entry: string, subdir: 'sources' | 'chunks', file: string): void
  /** 删除整个 <entry> 目录 */
  removeEntry(entry: string): void
  /** docsDir 下存在任何 .old 旁挂目录时抛错 */
  assertNoOldSidecars(): void
  // ---- 沙箱判定 ----
  /** 归一化路径并断言其在 docsDir 内，越界抛错 */
  assertInside(absPath: string): string
  /** 目标为受管 index.json 时抛错 */
  assertNotManagedIndexJson(absPath: string): void
}

export function createVault(docsDir: string): Vault {
  // ---- 路径解析（单一权威）----
  const rootIndexPath = () => path.join(docsDir, 'index.json')
  const entryDir = (entry: string) => path.join(docsDir, entry)
  const entryIndexPath = (entry: string) => path.join(docsDir, entry, 'index.json')
  const entrySubdir = (entry: string, subdir: 'sources' | 'chunks') =>
    path.join(docsDir, entry, subdir)

  function assertTopic(topic: string): void {
    if (!SLUG_RE.test(topic)) {
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

  // ============================================================
  // 读 / 查（原 knowledge-store，逐字保持）
  // ============================================================

  async function listTopics(): Promise<TopicSummary[]> {
    const parsed = await readJsonOr<RootIndex>(rootIndexPath(), { topics: [] })
    return Array.isArray(parsed.topics) ? parsed.topics : []
  }

  async function getTopic(topic: string): Promise<TopicDetail> {
    assertTopic(topic)
    const indexPath = entryIndexPath(topic)
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
    const rootPath = rootIndexPath()
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
    const topicDir = entryDir(slug)
    const topicPath = entryIndexPath(slug)
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
    const topicPath = entryIndexPath(topic)
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
      entries = await fs.readdir(docsDir)
    } catch {
      return []
    }
    for (const topic of entries) {
      if (!SLUG_RE.test(topic)) continue
      if (!topicIndexCache.has(topic)) {
        const idx = await readJsonOr<TopicIndex | null>(entryIndexPath(topic), null)
        topicIndexCache.set(topic, idx)
      }
      const topicIdx = topicIndexCache.get(topic) ?? null
      const topicTags = topicIdx && Array.isArray(topicIdx.tags) ? topicIdx.tags : []
      const chunkRefs = topicIdx && Array.isArray(topicIdx.chunks) ? topicIdx.chunks : []
      const topicTagHit = (term: string) => topicTags.some(t => t.toLowerCase().includes(term))

      const chunksDir = entrySubdir(topic, 'chunks')
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
    const filePath = path.join(entrySubdir(topic, 'chunks'), `${chunkId}.md`)
    // 二次校验：解析后路径必须在 root/<topic>/chunks/ 内
    const resolved = path.resolve(filePath)
    const expectedDir = path.resolve(docsDir, topic, 'chunks')
    if (!resolved.startsWith(expectedDir + path.sep)) {
      throw new Error('access denied: chunk path escapes chunks dir')
    }
    return fs.readFile(resolved, 'utf8')
  }

  // ============================================================
  // 主题索引（async；缺失/坏 → null）
  // ============================================================

  async function readTopicIndex(slug: string): Promise<TopicIndex | null> {
    try {
      const raw = await fs.readFile(entryIndexPath(slug), 'utf8')
      return JSON.parse(raw) as TopicIndex
    } catch {
      return null
    }
  }

  async function readSidecarIndex(slug: string): Promise<TopicIndex | null> {
    try {
      const raw = await fs.readFile(entryIndexPath(`${slug}.old`), 'utf8')
      return JSON.parse(raw) as TopicIndex
    } catch {
      return null
    }
  }

  // ============================================================
  // 物理操作（sync）
  // ============================================================

  function assertSlug(slug: string, field = 'slug'): void {
    if (!SLUG_RE.test(slug)) {
      throw new Error(`invalid ${field}: ${slug}`)
    }
  }

  /** 重建 topic 目录：sources/（抓取/上传原料）+ chunks/（后续产物） */
  function prepareTopic(slug: string): void {
    const dir = entryDir(slug)
    fsSync.rmSync(dir, { recursive: true, force: true })
    fsSync.mkdirSync(path.join(dir, 'sources'), { recursive: true })
    fsSync.mkdirSync(path.join(dir, 'chunks'), { recursive: true })
  }

  /** 写一份原料到 <slug>/sources/source-NNN.md */
  function writeSourceFile(slug: string, index: number, url: string, text: string): void {
    const dir = entrySubdir(slug, 'sources')
    fsSync.mkdirSync(dir, { recursive: true })
    const name = `source-${String(index + 1).padStart(3, '0')}.md`
    fsSync.writeFileSync(path.join(dir, name), `Source: ${url}\n\n${text}`, 'utf8')
  }

  /** 数 <slug>/sources 下 .md 文件数量；目录不存在按 0 */
  function countSourceFiles(slug: string): number {
    try {
      return fsSync.readdirSync(entrySubdir(slug, 'sources')).filter((f) => f.endsWith('.md')).length
    } catch {
      return 0
    }
  }

  function readSourceBodies(slug: string): string[] {
    const dir = entrySubdir(slug, 'sources')
    const files = fsSync.readdirSync(dir).filter((f) => f.endsWith('.md')).sort()
    return files.map((f) => fsSync.readFileSync(path.join(dir, f), 'utf8'))
  }

  function writeOutline(slug: string, items: OutlineItem[]): void {
    assertSlug(slug, 'slug')
    const topicDir = entryDir(slug)
    if (!fsSync.existsSync(topicDir)) throw new Error(`topic dir not prepared: ${slug}`)
    if (!fsSync.existsSync(path.join(topicDir, 'sources'))) throw new Error(`sources missing for topic: ${slug}`)
    fsSync.writeFileSync(
      path.join(topicDir, 'outline.json'),
      JSON.stringify({ slug, source: 'sources/', items }, null, 2),
    )
  }

  function readOutlineItems(slug: string): OutlineItem[] {
    const outlinePath = path.join(entryDir(slug), 'outline.json')
    if (!fsSync.existsSync(outlinePath)) throw new Error('outline 未生成')
    const outline = JSON.parse(fsSync.readFileSync(outlinePath, 'utf8')) as { items: OutlineItem[] }
    return outline.items
  }

  function parkTopic(slug: string): void {
    fsSync.renameSync(entryDir(slug), entryDir(`${slug}.old`))
  }

  function restoreTopic(slug: string): void {
    fsSync.renameSync(entryDir(`${slug}.old`), entryDir(slug))
  }

  function renameTopic(slug: string, newSlug: string): void {
    fsSync.renameSync(entryDir(slug), entryDir(newSlug))
  }

  function readEntryIndexSync(entry: string): TopicIndex {
    return JSON.parse(fsSync.readFileSync(entryIndexPath(entry), 'utf8')) as TopicIndex
  }

  function writeEntryIndexSync(entry: string, idx: TopicIndex): void {
    fsSync.writeFileSync(entryIndexPath(entry), JSON.stringify(idx, null, 2))
  }

  function readRootIndexSync(): RootIndex {
    return JSON.parse(fsSync.readFileSync(rootIndexPath(), 'utf8')) as RootIndex
  }

  function writeRootIndexSync(root: RootIndex): void {
    fsSync.writeFileSync(rootIndexPath(), JSON.stringify(root, null, 2))
  }

  /** 列出 dir 下的 .md 文件名（排序）；目录缺失视为空 */
  function listEntryMd(entry: string, subdir: 'sources' | 'chunks'): string[] {
    try {
      return fsSync.readdirSync(entrySubdir(entry, subdir)).filter(f => f.endsWith('.md')).sort()
    } catch {
      return []
    }
  }

  function mkdirEntrySubdir(entry: string, subdir: 'sources' | 'chunks'): void {
    fsSync.mkdirSync(entrySubdir(entry, subdir), { recursive: true })
  }

  function readEntryFile(entry: string, subdir: 'sources' | 'chunks', file: string): Buffer {
    return fsSync.readFileSync(path.join(entrySubdir(entry, subdir), file))
  }

  function writeEntryFile(entry: string, subdir: 'sources' | 'chunks', file: string, body: Buffer): void {
    fsSync.writeFileSync(path.join(entrySubdir(entry, subdir), file), body)
  }

  function unlinkEntryFile(entry: string, subdir: 'sources' | 'chunks', file: string): void {
    fsSync.unlinkSync(path.join(entrySubdir(entry, subdir), file))
  }

  function removeEntry(entry: string): void {
    fsSync.rmSync(entryDir(entry), { recursive: true, force: true })
  }

  // 阻断：docsDir 下存在任何 .old 旁挂目录时抛错，要求人工先处理。
  // docsDir 本身缺失时直接让 readdirSync 抛错（调用方本就应在已初始化的库上学习）。
  function assertNoOldSidecars(): void {
    const oldDir = fsSync.readdirSync(docsDir).find(name => name.endsWith('.old'))
    if (oldDir) {
      throw new Error(`检测到未清理的旁挂目录 ${oldDir}，请手工处理后再学习`)
    }
  }

  // ============================================================
  // 沙箱判定
  // ============================================================

  function assertInside(absPath: string): string {
    const resolved = path.resolve(absPath)
    if (resolved !== docsDir && !resolved.startsWith(docsDir + path.sep)) {
      throw new Error(
        `Access denied: ${absPath} is outside the knowledge directory ${docsDir}`,
      )
    }
    return resolved
  }

  function assertNotManagedIndexJson(absPath: string): void {
    if (path.basename(absPath) === 'index.json') {
      throw new Error('index.json is managed by add_topic/add_chunk tools, do not write directly')
    }
  }

  return {
    root: docsDir,
    listTopics,
    getTopic,
    searchChunks,
    queryKnowledge,
    readChunk,
    upsertTopic,
    upsertChunkRef,
    readTopicIndex,
    readSidecarIndex,
    assertSlug,
    prepareTopic,
    writeSourceFile,
    countSourceFiles,
    readSourceBodies,
    writeOutline,
    readOutlineItems,
    parkTopic,
    restoreTopic,
    renameTopic,
    readEntryIndexSync,
    writeEntryIndexSync,
    readRootIndexSync,
    writeRootIndexSync,
    listEntryMd,
    mkdirEntrySubdir,
    readEntryFile,
    writeEntryFile,
    unlinkEntryFile,
    removeEntry,
    assertNoOldSidecars,
    assertInside,
    assertNotManagedIndexJson,
  }
}

// 默认单例：绑生产 docsDir
export const vault = createVault(path.join(dataDir, 'docs'))

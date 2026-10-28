// pi SDK 单例工厂：把 pi coding-agent 接到本地 ccm proxy 上。
// - ModelRuntime 懒加载，全局单例
// - registerProvider 注册一个 "ccm" provider，走 anthropic-messages 协议到本地 proxy
// - createPiSession() 返回一个新 AgentSession，cwd 钉死在 docsDir
// - 按 chat / outline / refine / tag 四种模式挂载不同工具集 + system prompt

import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { Type } from 'typebox'
import {
  createAgentSession,
  DefaultResourceLoader,
  ModelRuntime,
  createWriteToolDefinition,
  type AgentSession,
  type BeforeAgentStartEvent,
  type BeforeAgentStartEventResult,
  type BeforeProviderHeadersEvent,
  type ToolDefinition,
} from '@earendil-works/pi-coding-agent'
import { dataDir } from './paths.js'
import { sandboxWriteOps } from './pi-sandbox-ops.js'
import { knowledgeStore } from './knowledge-store.js'
import { createCrawlTools, type CrawlGuard } from './pi-crawl-tools.js'

// 知识文档目录：所有文件工具的 cwd 和沙箱白名单根
const docsDir = path.join(dataDir, 'docs')
// pi agent 目录（auth / models / system.md）
const agentDir = path.join(os.homedir(), '.cc-monitoring', 'pi')

let runtimePromise: Promise<ModelRuntime> | null = null
let runtimePort = 0

async function getRuntime(port: number): Promise<ModelRuntime> {
  if (!runtimePromise || runtimePort !== port) {
    runtimePort = port
    runtimePromise = (async () => {
      fs.mkdirSync(agentDir, { recursive: true })

      const runtime = await ModelRuntime.create({
        authPath: path.join(agentDir, 'auth.json'),
        modelsPath: path.join(agentDir, 'models.json'),
        refreshOnCreate: false,
        allowModelNetwork: false,
      })

      const baseUrl = `http://localhost:${port}`
      runtime.registerProvider('ccm', {
        name: 'ccm',
        baseUrl,
        apiKey: 'unused',
        api: 'anthropic-messages',
        models: [
          {
            id: 'placeholder',
            name: 'ccm placeholder',
            api: 'anthropic-messages',
            baseUrl,
            input: ['text'],
            cost: {
              input: 0,
              output: 0,
              cacheRead: 0,
              cacheWrite: 0,
            },
            reasoning: true,
            contextWindow: 200_000,
            maxTokens: 8_192,
          },
        ],
      })

      return runtime
    })()
  }
  return runtimePromise
}

// ============================================================

export type PiSessionMode = 'chat' | 'outline' | 'refine' | 'tag' | 'crawl'

export interface CreatePiSessionOptions {
  cwd?: string
  port: number
  mode: PiSessionMode
  /** mode='crawl' 时必填：渐进抓取状态守卫 */
  crawlGuard?: CrawlGuard
}

const KB_STRUCTURE = `Your knowledge directory (~/.cc-monitoring/docs) stores a **dictionary**: concise, distilled entries a future reader can look up. You do NOT copy source text — you digest it.

STRUCTURE (all paths below are RELATIVE TO the knowledge root ~/.cc-monitoring/docs — the write tool's working directory IS this root, so NEVER prefix a path with "docs/"):
- Each topic is a subfolder: <topic-slug>/
- Each topic has <slug>/index.json (metadata + chunk list, NO body)
- Bodies live in <topic-slug>/chunks/chunk-NNN.md
- Root index.json lists all topics as JSON
- Fetched source pages for a topic are already prepared in <slug>/sources/ — you only READ them, never write or modify them`

export const CHAT_SYSTEM_PROMPT = `You are a knowledge management AI operating inside a sandbox.
${KB_STRUCTURE}

ANSWERING QUESTIONS:
1. Call list_topics to see available topics
2. If topic is unclear, call search_chunks(query) to find relevant chunks across topics
3. Call get_topic(topic) to see that topic's chunk list
4. Call read_chunk(topic, chunk_id) for relevant chunks — only read chunks you need
5. Prefer answering from knowledge base chunks when relevant content exists; cite which chunks you used
6. If no relevant chunk exists, answer from your general knowledge; if you truly don't know, say so`

export const OUTLINE_SYSTEM_PROMPT = `You are an outline-phase worker. The relevant web pages have ALREADY been fetched and saved to sources/ for your assigned topic. Your job: read them and propose an outline of dictionary entries. Do NOT write chunks.

${KB_STRUCTURE}

WORKFLOW:
1. Call read_source(topic) to load ALL fetched source pages (multiple pages are separated by ---).
2. Outline the DISTINCT concepts actually present across these pages. One concept = one future chunk. Do not bundle unrelated ideas.
3. Call add_outline(slug, title, items) ONCE at the end:
   - slug: the EXACT slug given in your task
   - title: human-readable topic title
   - items: array of { id, title, oneLine } — id is a short stable slug per item (e.g. "use-state"), oneLine is a single-sentence definition

HARD RULES:
- Use ONLY content present in the fetched sources. Do NOT add concepts from training-data memory. If the sources are thin, outline only what is there.
- read_source MUST be your first call. If it returns an error, STOP and report it immediately.
- Do NOT write chunk files, source files, or index.json.
- Do NOT summarize prematurely — outline only; distillation happens later.
- After add_outline succeeds, print the returned slug and item count. Stop.`

export const CRAWL_SYSTEM_PROMPT = `You are a crawl-phase worker. You drive the browser YOURSELF to incrementally fetch web pages for your assigned topic and save every useful page into sources/. Do NOT outline or write chunks.

WORKFLOW:
1. Call crawl_open to open the entry URL given in your task.
2. Call save_source(url) to save the CURRENT page.
3. From the page's links, pick same-site, valuable CONTENT pages — skip login/signup, navigation chrome, language switchers, pagination, and pure anchors. Call crawl_visit(url), then save_source(url) for each page.
4. When there are no more useful links, or the page/depth limit is reached, call crawl_finish, print the returned stats, and stop.

HARD RULES:
- Write ONLY into sources/ via save_source. Never write other files.
- Never visit cross-site URLs.
- If a tool returns an error, do NOT retry the same URL; pick another link or finish.
- At most ~20 pages. Prefer a few dense pages over many thin ones.
- After crawl_finish succeeds, stop.`

export const REFINE_SYSTEM_PROMPT = `You are a refine-phase worker. For ONE item from the topic's outline, produce a single dictionary chunk.

${KB_STRUCTURE}

WORKFLOW:
1. Call read_source(topic) to load ALL fetched source pages (multiple pages separated by ---).
2. Focus on your assigned item. Do NOT distill other items.
3. Write ONE chunk file <topic>/chunks/chunk-NNN.md (number sequentially from 001; path RELATIVE TO the knowledge root, no "docs/" prefix) using the write tool, in the source document's language, with this structure:

\`\`\`
# <term or concept name>

- 定义 / Definition: <one sentence, in your own words>
- 是什么 / What it is: <2-4 bullets, the core idea>
- 不是什么 / What it is NOT: <common confusions, if any>
- 关键点 / Key points: <3-6 bullets, the load-bearing facts>
- 适用场景 / When to use: <where this applies>
- 误区 / Pitfalls: <common mistakes, edge cases>
- 来源 / Source: <url(s) of the page(s) you actually used — copy them from the "Source:" headers at the top of each fetched page; list several URLs if the chunk draws on several pages>
\`\`\`

4. Call add_chunk(topic, chunk_id, title, summary, tags) to register it.
   - tags: 3-6 lowercase hyphenated tags describing the concept (synonyms, key terms).

HARD RULES:
- read_source MUST be your first call. If it returns an error, STOP and report it immediately. Do NOT write a placeholder source.md yourself, and do NOT write the chunk from memory.
- Every fact must come from the fetched sources. If a claim is not supported by them, omit it. Never fill gaps from memory.
- NO large quotes. A short quote (≤2 sentences) is allowed ONLY as evidence under a bullet you already wrote in your own words.
- Every bullet must be YOU re-expressing the idea. If you find yourself copying sentences, stop and rephrase.
- One concept per chunk.
- If the material is thin on a concept, write what exists; do NOT invent content. Omit empty sections.
- Do NOT call add_topic. Do NOT write index.json.`

export const TAG_SYSTEM_PROMPT = `You are a tag-phase worker. Enrich an existing topic with rich, retrieval-friendly tags.

${KB_STRUCTURE}

WORKFLOW:
1. Call get_topic(slug) to list this topic's chunks.
2. Call read_chunk for the chunks to understand the actual content.
3. Generate 5 categories of tags (10-20 total), all lowercase hyphenated:
   - synonyms: alternate names / aliases
   - hypernym: broader parent concept (e.g. "state-management" for redux)
   - trigger-scenarios: situations where a reader would reach for this (e.g. "form-validation")
   - confusable: things this is often mixed up with
   - typical-questions: questions a reader might search (e.g. "how-does-usestate-work")
4. Call add_topic(slug, title, summary, tags) to OVERWRITE the topic's tags + metadata. Reuse the existing title and summary from get_topic; do not change them.

HARD RULES:
- Do NOT write chunk files. Do NOT call add_chunk.
- Do NOT invent tags the content does not support.`

/** 从 ~/.cc-monitoring/pi/system.md 读取自定义 system prompt（仅 chat 模式覆盖） */
function loadChatSystemPrompt(): string {
  const mdPath = path.join(agentDir, 'system.md')
  try {
    return fs.readFileSync(mdPath, 'utf8')
  } catch {
    return CHAT_SYSTEM_PROMPT
  }
}

function systemPromptForMode(mode: PiSessionMode): string {
  switch (mode) {
    case 'chat':
      return loadChatSystemPrompt()
    case 'outline':
      return OUTLINE_SYSTEM_PROMPT
    case 'crawl':
      return CRAWL_SYSTEM_PROMPT
    case 'refine':
      return REFINE_SYSTEM_PROMPT
    case 'tag':
      return TAG_SYSTEM_PROMPT
  }
}

// ============================================================
// 工具构造

const ok = (text: string) => ({ content: [{ type: 'text' as const, text }], details: undefined })
const err = (e: unknown) => ({ content: [{ type: 'text' as const, text: `error: ${e instanceof Error ? e.message : String(e)}` }], details: undefined })

interface OutlineItemParam { id: string; title: string; oneLine: string }

// 与 knowledge-store TOPIC_RE 保持一致：防路径穿越（../、绝对路径、反斜杠等）
const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/
function assertSlug(slug: string, field: string): void {
  if (!SLUG_RE.test(slug)) {
    throw new Error(`invalid ${field}: ${slug}`)
  }
}

/** add_outline：对已存在的 slug 目录登记大纲（写 outline.json + seed topic） */
function buildAddOutlineTool(): ToolDefinition {
  return {
    name: 'add_outline',
    label: 'add_outline',
    description: '在已由抓取阶段准备好的 <slug> 目录登记大纲（写 outline.json + seed topic），只调用一次。',
    parameters: Type.Object({
      slug: Type.String({ description: '任务指定的小写连字符 slug，如 react-hooks' }),
      title: Type.String(),
      items: Type.Array(Type.Object({
        id: Type.String({ description: '条目稳定 id，如 use-state' }),
        title: Type.String(),
        oneLine: Type.String({ description: '一句话定义' }),
      })),
    }),
    async execute(_id, params: { slug: string; title: string; items: OutlineItemParam[] }) {
      assertSlug(params.slug, 'slug')
      const topicDir = path.join(docsDir, params.slug)
      if (!fs.existsSync(topicDir)) throw new Error(`topic dir not prepared: ${params.slug}`)
      if (!fs.existsSync(path.join(topicDir, 'sources'))) throw new Error(`sources missing for topic: ${params.slug}`)
      fs.writeFileSync(
        path.join(topicDir, 'outline.json'),
        JSON.stringify({ slug: params.slug, source: 'sources/', items: params.items }, null, 2),
      )
      await knowledgeStore.upsertTopic({
        slug: params.slug,
        title: params.title,
        summary: '(refining)',
        tags: [],
      })
      return ok(JSON.stringify({ slug: params.slug, itemCount: params.items.length }))
    },
  }
}

/** read_source：读取该主题 sources/ 目录下全部已抓取网页 */
function buildReadSourceTool(): ToolDefinition {
  return {
    name: 'read_source',
    label: 'read_source',
    description: '读取该主题 sources/ 目录下全部已抓取网页（按文件名排序、--- 分隔）。',
    parameters: Type.Object({ topic: Type.String({ description: '主题 slug' }) }),
    async execute(_id, params: { topic: string }) {
      assertSlug(params.topic, 'topic')
      const dir = path.join(docsDir, params.topic, 'sources')
      const files = fs.readdirSync(dir).filter((f) => f.endsWith('.md')).sort()
      if (files.length === 0) throw new Error(`no sources for topic: ${params.topic}`)
      const merged = files.map((f) => fs.readFileSync(path.join(dir, f), 'utf8')).join('\n\n---\n\n')
      return ok(merged)
    },
  }
}

/** 知识检索领域工具 */
function buildKnowledgeTools(): ToolDefinition[] {
  return [
    {
      name: 'list_topics',
      label: 'list_topics',
      description: '列出所有知识主题及一句话摘要。检索知识时第一步调用，发现有哪些主题可用。',
      parameters: Type.Object({}),
      async execute() {
        try { return ok(JSON.stringify(await knowledgeStore.listTopics(), null, 2)) }
        catch (e) { return err(e) }
      },
    },
    {
      name: 'get_topic',
      label: 'get_topic',
      description: '获取某主题的元数据与片段清单（描述级，不含正文）。读正文前先调用，看有哪些 chunk。',
      parameters: Type.Object({ topic: Type.String({ description: '主题 slug，如 react-hooks' }) }),
      async execute(_id, params: { topic: string }) {
        try { return ok(JSON.stringify(await knowledgeStore.getTopic(params.topic), null, 2)) }
        catch (e) { return err(e) }
      },
    },
    {
      name: 'search_chunks',
      label: 'search_chunks',
      description: '跨主题关键词检索片段，返回命中清单（不含正文）。主题不明时用。',
      parameters: Type.Object({ query: Type.String({ description: '搜索关键词' }) }),
      async execute(_id, params: { query: string }) {
        try { return ok(JSON.stringify(await knowledgeStore.searchChunks(params.query), null, 2)) }
        catch (e) { return err(e) }
      },
    },
    {
      name: 'read_chunk',
      label: 'read_chunk',
      description: '读取单个知识片段正文。一次只读一片。读前先 get_topic 发现 chunk id。',
      parameters: Type.Object({
        topic: Type.String({ description: '主题 slug' }),
        chunk_id: Type.String({ description: 'chunk id，如 chunk-001' }),
      }),
      async execute(_id, params: { topic: string; chunk_id: string }) {
        try { return ok(await knowledgeStore.readChunk(params.topic, params.chunk_id)) }
        catch (e) { return err(e) }
      },
    },
    {
      name: 'add_topic',
      label: 'add_topic',
      description: '注册或更新一个知识主题（原子读改写 index.json）。LLM 不要直接写 index.json 文件。',
      parameters: Type.Object({
        slug: Type.String({ description: '主题 slug，小写连字符，如 react-hooks' }),
        title: Type.String(),
        summary: Type.String(),
        tags: Type.Array(Type.String()),
      }),
      async execute(_id, params: { slug: string; title: string; summary: string; tags: string[] }) {
        try {
          await knowledgeStore.upsertTopic(params)
          return ok('topic added')
        } catch (e) { return err(e) }
      },
    },
    {
      name: 'add_chunk',
      label: 'add_chunk',
      description: '登记或更新一个 chunk 在主题索引中的引用（原子读改写）。写完 chunk-NNN.md 正文后调用。',
      parameters: Type.Object({
        topic: Type.String(),
        chunk_id: Type.String({ description: '如 chunk-001' }),
        title: Type.String(),
        summary: Type.String(),
        tags: Type.Array(Type.String({ description: '小写连字符标签，3-6 个' })),
      }),
      async execute(_id, params: { topic: string; chunk_id: string; title: string; summary: string; tags: string[] }) {
        try {
          await knowledgeStore.upsertChunkRef({
            topic: params.topic,
            chunkId: params.chunk_id,
            title: params.title,
            summary: params.summary,
            tags: params.tags,
          })
          return ok('chunk ref added')
        } catch (e) { return err(e) }
      },
    },
  ]
}

const KNOWLEDGE_TOOLS = buildKnowledgeTools()
const KT = (name: string): ToolDefinition => KNOWLEDGE_TOOLS.find((t) => t.name === name)!

const WRITE_TOOL = createWriteToolDefinition(docsDir, { operations: sandboxWriteOps }) as ToolDefinition

/** 按模式构建工具集（ToolDefinition 数组，用于 customTools） */
function buildModeTools(mode: PiSessionMode, crawlGuard?: CrawlGuard): ToolDefinition[] {
  switch (mode) {
    case 'chat':
      return [KT('list_topics'), KT('get_topic'), KT('search_chunks'), KT('read_chunk')]
    case 'outline':
      return [buildReadSourceTool(), buildAddOutlineTool()]
    case 'crawl':
      if (!crawlGuard) throw new Error('crawl 模式必须传入 crawlGuard')
      return createCrawlTools(crawlGuard)
    case 'refine':
      return [buildReadSourceTool(), WRITE_TOOL, KT('add_chunk')]
    case 'tag':
      return [KT('list_topics'), KT('get_topic'), KT('read_chunk'), KT('add_topic')]
  }
}

/** 按模式构建工具白名单（tools 字段，全小写） */
function buildToolAllowlist(mode: PiSessionMode): string[] {
  switch (mode) {
    case 'chat':
      return ['list_topics', 'get_topic', 'search_chunks', 'read_chunk']
    case 'outline':
      return ['read_source', 'add_outline']
    case 'crawl':
      return ['crawl_open', 'save_source', 'crawl_visit', 'crawl_finish']
    case 'refine':
      return ['read_source', 'write', 'add_chunk']
    case 'tag':
      return ['list_topics', 'get_topic', 'read_chunk', 'add_topic']
  }
}

export async function createPiSession(options: CreatePiSessionOptions): Promise<AgentSession> {
  const runtime = await getRuntime(options.port)

  const model = runtime.getModel('ccm', 'placeholder')
  if (!model) {
    throw new Error('pi runtime: ccm/placeholder model not registered')
  }

  // cwd 钉死 docsDir，忽略传入的 process.cwd()
  const cwd = options.cwd ?? docsDir

  // 闭包捕获：pi 的 sessionId 在 createAgentSession 返回后才知道，
  // 但 before_provider_headers handler 是每次上游请求时才触发，
  // 所以先放一个可变变量，返回 session 后再填值。
  let currentSessionId = ''

  const systemPrompt = systemPromptForMode(options.mode)
  const modeTools = buildModeTools(options.mode, options.crawlGuard)
  const toolAllowlist = buildToolAllowlist(options.mode)

  const resourceLoader = new DefaultResourceLoader({
    cwd,
    agentDir,
    extensionFactories: [
      (pi) => {
        // 注入 x-claude-code-session-id header（保留原有逻辑）
        pi.on('before_provider_headers', (ev: BeforeProviderHeadersEvent) => {
          if (currentSessionId) {
            ev.headers['x-claude-code-session-id'] = currentSessionId
          }
        })
        // 通过 before_agent_start 事件注入 system prompt
        pi.on(
          'before_agent_start',
          (): BeforeAgentStartEventResult => {
            return { systemPrompt }
          },
        )
      },
    ],
  })
  await resourceLoader.reload()

  const { session } = await createAgentSession({
    cwd,
    agentDir,
    modelRuntime: runtime,
    model,
    noTools: 'builtin',          // 禁用 pi 默认 read/bash/edit/write，保留 customTools
    customTools: modeTools,
    tools: toolAllowlist,       // 全小写工具名白名单
    resourceLoader,
  })

  // 在 session.prompt() 之前填入真实 sessionId
  currentSessionId = session.sessionId

  return session
}

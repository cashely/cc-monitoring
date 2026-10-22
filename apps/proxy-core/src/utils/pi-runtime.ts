// pi SDK 单例工厂：把 pi coding-agent 接到本地 ccm proxy 上。
// - ModelRuntime 懒加载，全局单例
// - registerProvider 注册一个 "ccm" provider，走 anthropic-messages 协议到本地 proxy
// - createPiSession() 返回一个新 AgentSession，cwd 钉死在 docsDir
// - 按 chat / learn 两种模式挂载不同工具集

import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { Type } from 'typebox'
import {
  createAgentSession,
  DefaultResourceLoader,
  ModelRuntime,
  createWriteToolDefinition,
  createEditToolDefinition,
  type AgentSession,
  type BeforeAgentStartEvent,
  type BeforeAgentStartEventResult,
  type BeforeProviderHeadersEvent,
  type ToolDefinition,
} from '@earendil-works/pi-coding-agent'
import { dataDir } from './paths.js'
import {
  sandboxWriteOps,
  sandboxEditOps,
} from './pi-sandbox-ops.js'
import { browserTools } from './pi-browser-tools.js'
import { knowledgeStore } from './knowledge-store.js'

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

export type PiSessionMode = 'chat' | 'learn'

export interface CreatePiSessionOptions {
  cwd?: string
  port: number
  mode: PiSessionMode
}

// 默认 system prompt 兜底（system.md 不存在时使用）
const DEFAULT_SYSTEM_PROMPT = `You are a knowledge management AI operating inside a sandbox.
Your knowledge directory (~/.cc-monitoring/docs) stores structured knowledge.

STRUCTURE:
- Each topic is a subfolder: docs/<topic-slug>/
- Each topic has docs/<slug>/index.json (metadata + chunk list, NO body)
- Bodies live in docs/<topic-slug>/chunks/chunk-NNN.md (300-500 words each)
- Root docs/index.json lists all topics as JSON

CHAT MODE (answer questions):
1. Call list_topics to see available topics
2. If topic is unclear, call search_chunks(query) to find relevant chunks across topics
3. Call get_topic(topic) to see that topic's chunk list
4. Call read_chunk(topic, chunk_id) for relevant chunks — only read chunks you need
5. Prefer answering from knowledge base chunks when relevant content exists; cite which chunks you used
6. If no relevant chunk exists, answer from your general knowledge; if you truly don't know, say so

LEARN MODE (distill web pages into knowledge):
1. Call list_topics first to check for existing similar topics — reuse, don't duplicate
2. Use browser tools to read web pages
3. Distill into 300-500 word chunks, one point per chunk
4. Write chunks to docs/<topic-slug>/chunks/chunk-NNN.md (include source URL + quote)
5. Call add_topic(slug, title, summary, tags) to register/update the topic in the index
6. Call add_chunk(topic, chunk_id, title, summary) for each chunk you wrote
Do NOT write or edit index.json files directly — use add_topic/add_chunk tools
`

/** 从 ~/.cc-monitoring/pi/system.md 读取自定义 system prompt，不存在则用兜底文本 */
function loadSystemPrompt(): string {
  const mdPath = path.join(agentDir, 'system.md')
  try {
    return fs.readFileSync(mdPath, 'utf8')
  } catch {
    return DEFAULT_SYSTEM_PROMPT
  }
}

/** 构造知识检索领域工具（chat / learn 共用） */
function buildKnowledgeTools(): ToolDefinition[] {
  const ok = (text: string) => ({ content: [{ type: 'text' as const, text }], details: undefined })
  const err = (e: unknown) => ({ content: [{ type: 'text' as const, text: `error: ${e instanceof Error ? e.message : String(e)}` }], details: undefined })

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
      }),
      async execute(_id, params: { topic: string; chunk_id: string; title: string; summary: string }) {
        try {
          await knowledgeStore.upsertChunkRef({
            topic: params.topic,
            chunkId: params.chunk_id,
            title: params.title,
            summary: params.summary,
          })
          return ok('chunk ref added')
        } catch (e) { return err(e) }
      },
    },
  ]
}

/** 按模式构建工具集（ToolDefinition 数组，用于 customTools） */
function buildModeTools(mode: PiSessionMode): ToolDefinition[] {
  const knowledgeTools = buildKnowledgeTools()

  if (mode === 'chat') {
    // chat：只用领域工具，移除通用 read/grep/find/ls（防全量灌入）
    return knowledgeTools
  }

  // learn：领域工具（查重/读现有）+ write/edit + browser
  // 注意：createXxxToolDefinition 返回带具体 schema 的 ToolDefinition<TParams, ...>，
  // 与无泛型的 ToolDefinition 在 renderCall 上不协变，需要 as ToolDefinition 抹平。
  return [
    ...knowledgeTools,
    createWriteToolDefinition(docsDir, { operations: sandboxWriteOps }) as ToolDefinition,
    createEditToolDefinition(docsDir, { operations: sandboxEditOps }) as ToolDefinition,
    ...browserTools,
  ]
}

/** 按模式构建工具白名单（tools 字段，全小写） */
function buildToolAllowlist(mode: PiSessionMode): string[] {
  const base = ['list_topics', 'get_topic', 'search_chunks', 'read_chunk']
  if (mode === 'chat') {
    return base
  }
  return [...base, 'add_topic', 'add_chunk', 'write', 'edit', ...browserTools.map((t) => t.name)]
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

  const systemPrompt = loadSystemPrompt()
  const modeTools = buildModeTools(options.mode)
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
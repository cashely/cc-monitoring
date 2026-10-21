// pi SDK 单例工厂：把 pi coding-agent 接到本地 ccm proxy 上。
// - ModelRuntime 懒加载，全局单例
// - registerProvider 注册一个 "ccm" provider，走 anthropic-messages 协议到本地 proxy
// - createPiSession() 返回一个新 AgentSession，cwd 钉死在 docsDir
// - 按 chat / learn 两种模式挂载不同工具集

import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import {
  createAgentSession,
  DefaultResourceLoader,
  ModelRuntime,
  createReadToolDefinition,
  createWriteToolDefinition,
  createEditToolDefinition,
  createGrepToolDefinition,
  createFindToolDefinition,
  createLsToolDefinition,
  type AgentSession,
  type BeforeAgentStartEvent,
  type BeforeAgentStartEventResult,
  type BeforeProviderHeadersEvent,
  type ToolDefinition,
} from '@earendil-works/pi-coding-agent'
import { dataDir } from './paths.js'
import {
  sandboxReadOps,
  sandboxWriteOps,
  sandboxEditOps,
  sandboxGrepOps,
  sandboxFindOps,
  sandboxLsOps,
} from './pi-sandbox-ops.js'
import { browserTools } from './pi-browser-tools.js'

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
Your knowledge directory is the only filesystem you can access (~/.cc-monitoring/docs).
Chat mode: answer questions by searching the stored markdown documents with grep/find/read. Never invent answers you cannot find.
Learn mode: use browser tools to read web pages, then write distilled markdown notes into the knowledge directory.
Do not attempt to read host files outside the knowledge directory.`

/** 从 ~/.cc-monitoring/pi/system.md 读取自定义 system prompt，不存在则用兜底文本 */
function loadSystemPrompt(): string {
  const mdPath = path.join(agentDir, 'system.md')
  try {
    return fs.readFileSync(mdPath, 'utf8')
  } catch {
    return DEFAULT_SYSTEM_PROMPT
  }
}

/** 按模式构建工具集（ToolDefinition 数组，用于 customTools） */
function buildModeTools(mode: PiSessionMode): ToolDefinition[] {
  // 共享的只读工具（chat / learn 都有）
  // 注意：createXxxToolDefinition 返回带具体 schema 的 ToolDefinition<TParams, ...>，
  // 与无泛型的 ToolDefinition 在 renderCall 上不协变，需要 as ToolDefinition 抹平。
  const readOnlyTools: ToolDefinition[] = [
    createReadToolDefinition(docsDir, { operations: sandboxReadOps }) as ToolDefinition,
    createGrepToolDefinition(docsDir, { operations: sandboxGrepOps }) as ToolDefinition,
    createFindToolDefinition(docsDir, { operations: sandboxFindOps }) as ToolDefinition,
    createLsToolDefinition(docsDir, { operations: sandboxLsOps }) as ToolDefinition,
  ]

  if (mode === 'chat') {
    return readOnlyTools
  }

  // learn 模式：加上 write / edit + browser 工具
  return [
    ...readOnlyTools,
    createWriteToolDefinition(docsDir, { operations: sandboxWriteOps }) as ToolDefinition,
    createEditToolDefinition(docsDir, { operations: sandboxEditOps }) as ToolDefinition,
    ...browserTools,
  ]
}

/** 按模式构建工具白名单（tools 字段，全小写） */
function buildToolAllowlist(mode: PiSessionMode): string[] {
  const base = ['read', 'grep', 'find', 'ls']
  if (mode === 'chat') {
    return base
  }
  return [...base, 'write', 'edit', ...browserTools.map((t) => t.name)]
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
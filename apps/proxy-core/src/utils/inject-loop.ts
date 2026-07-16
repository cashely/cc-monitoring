import { findEnabledTool } from '../tools/index.js'

/**
 * 内部循环（后端）——命中注入 tool 后，proxy 代行「执行 tool -> 追加对话 -> 再调上游」，
 * 直到模型给出 end_turn 的最终文本，再由调用方合成 SSE 回写给客户端。
 *
 * 命中检测与执行都面向注册表：任意已启用 tool 被模型调用即命中，执行其 exec。
 */

export interface ParsedBlock {
  type: string
  text?: string
  id?: string
  name?: string
  input?: any
}

export interface ParsedUpstream {
  blocks: ParsedBlock[]
  stopReason: string
  usage: any
}

/** 解析上游 SSE 全文 -> 事件数组（收集 data: 行的 JSON） */
export function parseSSEText(text: string): any[] {
  const events: any[] = []
  for (const line of text.split('\n')) {
    if (line.startsWith('data:')) {
      const d = line.slice(5).trim()
      if (d && d !== '[DONE]') {
        try {
          events.push(JSON.parse(d))
        } catch {
          // 非 JSON 行跳过
        }
      }
    }
  }
  return events
}

/** 从事件数组重建有序内容块 + stop_reason + usage */
export function parseUpstreamEvents(events: any[]): ParsedUpstream {
  const blocks = new Map<number, ParsedBlock>()
  let stopReason = ''
  let usage: any = undefined

  for (const e of events) {
    if (e?.type === 'content_block_start') {
      const cb = e.content_block || {}
      blocks.set(e.index, {
        type: cb.type,
        text: cb.type === 'text' ? '' : undefined,
        id: cb.id,
        name: cb.name,
        input: cb.type === 'tool_use' ? '' : undefined
      })
    } else if (e?.type === 'content_block_delta') {
      const b = blocks.get(e.index)
      if (!b) continue
      const d = e.delta || {}
      if (d.type === 'text_delta') b.text = (b.text || '') + d.text
      if (d.type === 'thinking_delta') b.text = (b.text || '') + d.thinking
      if (d.type === 'input_json_delta') b.input = (b.input || '') + (d.partial_json || '')
    } else if (e?.type === 'message_delta') {
      stopReason = e.delta?.stop_reason || stopReason
      usage = e.usage
    }
  }

  const ordered = Array.from(blocks.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([, b]) => {
      if (b.type === 'tool_use') {
        let input = {}
        try {
          input = b.input ? JSON.parse(b.input as string) : {}
        } catch {
          input = {}
        }
        return { ...b, input }
      }
      return b
    })

  return { blocks: ordered, stopReason, usage }
}

/** 找出命中的、已启用的注入 tool 调用块 */
export function findInjectedCall(parsed: ParsedUpstream): ParsedBlock | undefined {
  return parsed.blocks.find(
    (b) => b.type === 'tool_use' && !!b.name && !!findEnabledTool(b.name)
  )
}

/** 把有序块转成 API assistant content（仅 text + tool_use，跳过 thinking 避免 signature 问题） */
function blocksToAssistantContent(blocks: ParsedBlock[]): any[] {
  const content: any[] = []
  for (const b of blocks) {
    if (b.type === 'text' && b.text) content.push({ type: 'text', text: b.text })
    if (b.type === 'tool_use') content.push({ type: 'tool_use', id: b.id, name: b.name, input: b.input })
  }
  return content
}

function collectText(parsed: ParsedUpstream): string {
  return parsed.blocks
    .filter((b) => b.type === 'text' && b.text)
    .map((b) => b.text)
    .join('')
}

export interface InjectLoopResult {
  text: string
  iterations: number
  stoppedByLimit: boolean
}

/**
 * SSE 内部循环：命中已启用 tool -> 执行 exec -> 追加对话 -> 再调上游 -> 直到 end_turn。
 * opts.body 会被原地追加 messages。
 *
 * @param opts.events 首次上游响应事件（已确认命中注入 tool）
 * @param opts.callUpstream 用给定 body 再次调上游，返回事件数组
 * @param opts.maxIterations 死循环护栏（tool 描述可能诱导模型反复调用）
 */
export async function runInjectLoop(opts: {
  events: any[]
  body: any
  callUpstream: (body: any) => Promise<any[]>
  maxIterations?: number
}): Promise<InjectLoopResult> {
  const maxIterations = opts.maxIterations ?? 3
  let parsed = parseUpstreamEvents(opts.events)
  let iterations = 0

  while (iterations < maxIterations) {
    const call = findInjectedCall(parsed)
    if (!call || parsed.stopReason !== 'tool_use') {
      return { text: collectText(parsed), iterations, stoppedByLimit: false }
    }

    const tool = findEnabledTool(call.name!)!
    const result = await tool.exec(call.input)
    opts.body.messages.push({ role: 'assistant', content: blocksToAssistantContent(parsed.blocks) })
    opts.body.messages.push({
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: call.id, content: result }]
    })

    const nextEvents = await opts.callUpstream(opts.body)
    parsed = parseUpstreamEvents(nextEvents)
    iterations++
  }

  return { text: collectText(parsed) || '(内部循环达到最大轮次)', iterations, stoppedByLimit: true }
}

export interface JsonInjectLoopResult {
  finalBody: any
  iterations: number
  stoppedByLimit: boolean
}

/**
 * JSON 内部循环：非流式请求中命中 MCP tool -> 执行 exec -> 追加对话 -> 再调上游 -> 直到 end_turn。
 * 与 SSE 版 runInjectLoop 对称，但处理 parsed JSON response body 而非 SSE event 数组。
 *
 * @param opts.initialBody 首次上游 JSON 响应（已确认命中 MCP tool）
 * @param opts.requestBody 请求体（messages 会被原地追加）
 * @param opts.callUpstream 用给定 body 再次调上游，返回 parsed JSON body
 * @param opts.maxIterations 死循环护栏
 */
export async function runJsonInjectLoop(opts: {
  initialBody: any
  requestBody: any
  callUpstream: (body: any) => Promise<any>
  maxIterations?: number
}): Promise<JsonInjectLoopResult> {
  const maxIterations = opts.maxIterations ?? 3
  let lastResponse = opts.initialBody
  let iterations = 0

  while (iterations < maxIterations) {
    const toolCalls = (lastResponse.content || []).filter((b: any) => b.type === 'tool_use')
    const hitCall = toolCalls.find((b: any) => findEnabledTool(b.name))
    if (!hitCall || lastResponse.stop_reason !== 'tool_use') break

    const tool = findEnabledTool(hitCall.name)!
    const result = await tool.exec(hitCall.input)

    opts.requestBody.messages.push({ role: 'assistant', content: lastResponse.content })
    opts.requestBody.messages.push({
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: hitCall.id, content: result }]
    })

    lastResponse = await opts.callUpstream(opts.requestBody)
    iterations++
  }

  const stoppedByLimit = iterations >= maxIterations &&
    lastResponse.stop_reason === 'tool_use' &&
    (lastResponse.content || []).some((b: any) => b.type === 'tool_use' && findEnabledTool(b.name))

  return { finalBody: lastResponse, iterations, stoppedByLimit }
}

import { PROBE_TOOL_NAME } from './tool-injector.js'

/**
 * 内部循环（后端）——命中注入 tool 后，proxy 代行「执行 tool -> 追加对话 -> 再调上游」，
 * 直到模型给出 end_turn 的最终文本，再由调用方合成 SSE 回写给客户端。
 *
 * 第 2/3 步（PoC）：tool 逻辑写死 mock 结果，只验证闭环成立。
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

/** 找出命中的 probe tool_use 块 */
export function findProbeCall(parsed: ParsedUpstream): ParsedBlock | undefined {
  return parsed.blocks.find((b) => b.type === 'tool_use' && b.name === PROBE_TOOL_NAME)
}

/** PoC：占位 tool 的执行逻辑（写死结果，验证闭环）。引导模型收尾避免反复调用。 */
export function mockProbeExecute(input: any): string {
  const echo = input?.echo ?? '(no echo)'
  return `Probe executed. Received echo: "${echo}". Now answer the user's actual question directly; do NOT call ${PROBE_TOOL_NAME} again.`
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
 * 内部循环：命中 probe -> 执行 -> 追加对话 -> 再调上游 -> 直到 end_turn。
 * opts.body 会被原地追加 messages。
 *
 * @param opts.events 首次上游响应事件（已确认命中 probe）
 * @param opts.callUpstream 用给定 body 再次调上游，返回事件数组
 * @param opts.maxIterations 死循环护栏（probe 描述会诱导模型反复调用）
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
    const probe = findProbeCall(parsed)
    if (!probe || parsed.stopReason !== 'tool_use') {
      return { text: collectText(parsed), iterations, stoppedByLimit: false }
    }

    const result = mockProbeExecute(probe.input)
    opts.body.messages.push({ role: 'assistant', content: blocksToAssistantContent(parsed.blocks) })
    opts.body.messages.push({
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: probe.id, content: result }]
    })

    const nextEvents = await opts.callUpstream(opts.body)
    parsed = parseUpstreamEvents(nextEvents)
    iterations++
  }

  return { text: collectText(parsed) || '(内部循环达到最大轮次)', iterations, stoppedByLimit: true }
}

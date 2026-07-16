import type { ServerResponse } from 'http'
import { findEnabledTool } from '../tools/index.js'
import { type ParsedBlock, type ParsedUpstream, findInjectedCall, parseUpstreamEvents } from './inject-loop.js'

/**
 * SSE 增量流式处理器：边转发原始 chunk 到客户端，边增量解析事件累积状态。
 * stream end 后提供 getParsedUpstream() 和 hasInjectedToolUse() 供注入检测。
 *
 * 跨 chunk 行边界通过 leftover 缓冲处理（参考 SSEAccumulator）。
 */
export class SSEStreamProcessor {
  events: any[] = []
  private contentBlocks = new Map<number, ParsedBlock>()
  private stopReason = ''
  private usage: any = undefined
  private leftover = ''
  private raw: ServerResponse

  constructor(raw: ServerResponse) {
    this.raw = raw
  }

  /** 处理一个 chunk：转发到 reply.raw + 增量解析事件 */
  processChunk(chunk: Buffer): void {
    // 转发原始 chunk 到客户端
    this.raw.write(chunk)

    const text = this.leftover + chunk.toString('utf-8')
    const lines = text.split('\n')

    // 最后一行可能不完整，保留到下次
    this.leftover = lines.pop() || ''

    for (const line of lines) {
      if (line.startsWith('data:')) {
        const d = line.slice(5).trim()
        if (!d || d === '[DONE]') continue
        try {
          const event = JSON.parse(d)
          this.events.push(event)
          this.processEvent(event)
        } catch {
          // 非 JSON 行跳过
        }
      }
    }
  }

  /** 处理 leftover 中残留的最后一行（stream end 后调用） */
  flushLeftover(): void {
    if (this.leftover.startsWith('data:')) {
      const d = this.leftover.slice(5).trim()
      if (d && d !== '[DONE]') {
        try {
          const event = JSON.parse(d)
          this.events.push(event)
          this.processEvent(event)
        } catch {
          // skip
        }
      }
    }
    this.leftover = ''
  }

  /** 增量解析单个事件，更新 contentBlocks / stopReason / usage */
  private processEvent(e: any): void {
    if (e?.type === 'content_block_start') {
      const cb = e.content_block || {}
      this.contentBlocks.set(e.index, {
        type: cb.type,
        text: cb.type === 'text' ? '' : undefined,
        id: cb.id,
        name: cb.name,
        input: cb.type === 'tool_use' ? '' : undefined
      })
    } else if (e?.type === 'content_block_delta') {
      const b = this.contentBlocks.get(e.index)
      if (!b) return
      const d = e.delta || {}
      if (d.type === 'text_delta') b.text = (b.text || '') + d.text
      if (d.type === 'thinking_delta') b.text = (b.text || '') + d.thinking
      if (d.type === 'input_json_delta') b.input = (b.input || '') + (d.partial_json || '')
    } else if (e?.type === 'message_delta') {
      this.stopReason = e.delta?.stop_reason || this.stopReason
      this.usage = e.usage
    }
  }

  /** 从累积状态构建 ParsedUpstream */
  getParsedUpstream(): ParsedUpstream {
    const ordered = Array.from(this.contentBlocks.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([, b]) => {
        if (b.type === 'tool_use') {
          let input = {}
          try { input = b.input ? JSON.parse(b.input as string) : {} } catch { input = {} }
          return { ...b, input }
        }
        return b
      })

    return { blocks: ordered, stopReason: this.stopReason, usage: this.usage }
  }

  /** 检测是否有注入的 MCP tool_use */
  hasInjectedToolUse(): boolean {
    if (this.stopReason !== 'tool_use') return false
    const parsed = this.getParsedUpstream()
    return !!findInjectedCall(parsed)
  }
}

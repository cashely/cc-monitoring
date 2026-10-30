import type { ServerResponse } from 'http'
import { type ParsedUpstream, findInjectedCall, parseUpstreamEvents } from './inject-loop.js'
import { createEventDecoder, type SSEDecoder } from './sse-protocol.js'

/**
 * SSE 增量流式处理器：边转发原始 chunk 到客户端，边增量解析事件累积状态。
 * stream end 后提供 getParsedUpstream() 和 hasInjectedToolUse() 供注入检测。
 *
 * 跨 chunk 残帧由内部 sse-protocol decoder 缓冲处理。
 */
export class SSEStreamProcessor {
  events: any[] = []
  private decoder: SSEDecoder
  private raw: ServerResponse

  constructor(raw: ServerResponse) {
    this.raw = raw
    this.decoder = createEventDecoder((event) => this.events.push(event))
  }

  /** 处理一个 chunk：转发到 reply.raw + 增量解析事件 */
  processChunk(chunk: Buffer): void {
    // 转发原始 chunk 到客户端
    this.raw.write(chunk)

    this.decoder.write(chunk)
  }

  /** 收尾残帧（stream end 后调用） */
  flushLeftover(): void {
    this.decoder.end()
  }

  /** 从累积事件构建 ParsedUpstream */
  getParsedUpstream(): ParsedUpstream {
    return parseUpstreamEvents(this.events)
  }

  /** 检测是否有注入的 MCP tool_use */
  hasInjectedToolUse(): boolean {
    const parsed = this.getParsedUpstream()
    if (parsed.stopReason !== 'tool_use') return false
    return !!findInjectedCall(parsed)
  }
}

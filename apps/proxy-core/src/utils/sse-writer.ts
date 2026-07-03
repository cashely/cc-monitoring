import type { ServerResponse } from 'http'

/**
 * SSE 构造器（后端）—— 与 sse-accumulator（解析器）互为逆向。
 *
 * 用于 proxy 主动构造并回写合成 SSE 流，让 Claude Code 客户端
 * 将其识别为一次正常的模型文本回答。事件骨架遵循 Anthropic
 * Messages API 实测结构（见 docs/thinks/llm-request-response-patterns.md 第三部分）。
 */

/** 写单个 SSE 事件：`event: <type>\ndata: {json}\n\n`（Anthropic 双行格式） */
export function writeSSEEvent(raw: ServerResponse, event: { type: string; [k: string]: unknown }): void {
  raw.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)
}

/**
 * 把一段文本伪装成模型的正常 text 输出，构造完整合成流写回。
 *
 * @param messageId proxy 自己生成的消息 id（合成流无上游 id），全程保持一致
 */
export function writeTextAsSSE(raw: ServerResponse, text: string, messageId: string): void {
  writeSSEEvent(raw, {
    type: 'message_start',
    message: {
      type: 'message',
      id: messageId,
      role: 'assistant',
      content: [],
      model: 'auto',
      stop_reason: null,
      stop_sequence: null,
      usage: { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0 }
    }
  })
  writeSSEEvent(raw, { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })
  writeSSEEvent(raw, { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } })
  writeSSEEvent(raw, { type: 'content_block_stop', index: 0 })
  writeSSEEvent(raw, {
    type: 'message_delta',
    delta: { stop_reason: 'end_turn', stop_sequence: null },
    usage: { output_tokens: 0 }
  })
  writeSSEEvent(raw, { type: 'message_stop' })
}

/**
 * PoC 触发判断：最新一条 user message 是否包含魔法词 __MOCK__。
 * 兼容 content 为 string 或 block 数组两种形态。
 */
export function shouldMock(body: any): boolean {
  const messages = body?.messages
  if (!Array.isArray(messages)) return false

  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.role !== 'user') continue
    const content = messages[i].content
    if (typeof content === 'string') {
      return content.includes('__MOCK__')
    }
    if (Array.isArray(content)) {
      return content.some(
        (b: any) => b?.type === 'text' && typeof b.text === 'string' && b.text.includes('__MOCK__')
      )
    }
    return false
  }
  return false
}

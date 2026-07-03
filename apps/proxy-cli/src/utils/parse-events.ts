export interface ParsedResponse {
  thinking?: string
  text?: string
  toolCalls?: Array<{
    name: string
    id: string
    input: Record<string, any>
  }>
  usage: {
    inputTokens: number
    outputTokens: number
    cacheReadTokens?: number
  }
  stopReason: string
}

function parseToolInput(content: string): Record<string, any> {
  if (!content) return {}
  try {
    return JSON.parse(content)
  } catch {
    return { _raw: content }
  }
}

export function parseEvents(events: any[]): ParsedResponse {
  const blocks = new Map<number, any>()
  let usage = { inputTokens: 0, outputTokens: 0 }
  let stopReason = ''

  for (const event of events) {
    if (event.type === 'message_start') {
      usage.inputTokens = event.message.usage.input_tokens
    }

    if (event.type === 'content_block_start') {
      blocks.set(event.index, {
        type: event.content_block.type,
        content: '',
        id: event.content_block.id,
        name: event.content_block.name
      })
    }

    if (event.type === 'content_block_delta') {
      const block = blocks.get(event.index)
      if (!block) continue

      if (event.delta.type === 'thinking_delta') {
        block.content += event.delta.thinking
      }
      if (event.delta.type === 'input_json_delta' && event.delta.partial_json) {
        block.content += event.delta.partial_json
      }
      if (event.delta.type === 'text_delta') {
        block.content += event.delta.text
      }
    }

    if (event.type === 'message_delta') {
      usage.outputTokens = event.usage.output_tokens
      usage.cacheReadTokens = event.usage.cache_read_input_tokens
      stopReason = event.delta.stop_reason
    }
  }

  return {
    thinking: Array.from(blocks.values()).find(b => b.type === 'thinking')?.content,
    text: Array.from(blocks.values()).find(b => b.type === 'text')?.content,
    toolCalls: Array.from(blocks.values())
      .filter(b => b.type === 'tool_use')
      .map(b => ({ name: b.name, id: b.id, input: parseToolInput(b.content) })),
    usage,
    stopReason
  }
}
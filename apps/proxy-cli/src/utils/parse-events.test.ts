import { describe, it, expect } from 'vitest'
import { parseEvents } from './parse-events'

describe('parseEvents - tool_use 分片拼接', () => {
  it('累加多个 input_json_delta 片段为完整输入', () => {
    const events = [
      { type: 'message_start', message: { usage: { input_tokens: 10 } } },
      {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'tool_use', id: 'toolu_1', name: 'Read' }
      },
      { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"file_pa' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: 'th": "/foo' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '.ts"}' } },
      { type: 'message_delta', usage: { output_tokens: 5, cache_read_input_tokens: 2 }, delta: { stop_reason: 'tool_use' } }
    ]

    const result = parseEvents(events)

    expect(result.toolCalls).toEqual([
      { name: 'Read', id: 'toolu_1', input: { file_path: '/foo.ts' } }
    ])
  })

  it('空输入的 tool_use 返回空对象', () => {
    const events = [
      { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'toolu_2', name: 'Noop' } }
    ]

    const result = parseEvents(events)

    expect(result.toolCalls).toEqual([{ name: 'Noop', id: 'toolu_2', input: {} }])
  })

  it('无法解析的 JSON 回退为 _raw', () => {
    const events = [
      { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'toolu_3', name: 'Bad' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{not json' } }
    ]

    const result = parseEvents(events)

    expect(result.toolCalls).toEqual([{ name: 'Bad', id: 'toolu_3', input: { _raw: '{not json' } }])
  })

  it('多个 tool_use 块独立拼接', () => {
    const events = [
      { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 't1', name: 'A' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"x":1}' } },
      { type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 't2', name: 'B' } },
      { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"y":' } },
      { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '2}' } }
    ]

    const result = parseEvents(events)

    expect(result.toolCalls).toEqual([
      { name: 'A', id: 't1', input: { x: 1 } },
      { name: 'B', id: 't2', input: { y: 2 } }
    ])
  })

  it('拼接 text_delta 与 thinking_delta 不受影响', () => {
    const events = [
      { type: 'content_block_start', index: 0, content_block: { type: 'thinking' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: '想一' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: '想' } },
      { type: 'content_block_start', index: 1, content_block: { type: 'text' } },
      { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'Hello ' } },
      { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'World' } }
    ]

    const result = parseEvents(events)

    expect(result.thinking).toBe('想一想')
    expect(result.text).toBe('Hello World')
  })
})

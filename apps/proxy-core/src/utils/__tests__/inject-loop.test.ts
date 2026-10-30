// mock 注册表：提供一个已启用的 fake tool，供命中检测与内部循环执行
jest.mock('../../tools/index.js', () => ({
  findEnabledTool: (name: string) =>
    name === '__test_tool'
      ? { name: '__test_tool', enabled: true, exec: (input: any) => `executed: ${input?.echo ?? ''}` }
      : undefined
}))

import {
  parseUpstreamEvents,
  findInjectedCall
} from '../inject-loop.js'

const TOOL_NAME = '__test_tool'

// 构造一段 text end_turn 响应事件
function textResponse(text: string) {
  return [
    { type: 'message_start', message: { id: 'm', usage: { input_tokens: 1 } } },
    { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } },
    { type: 'content_block_stop', index: 0 },
    { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 5 } },
    { type: 'message_stop' }
  ]
}

// 构造一段调用注入 tool 的响应事件（input 分片传输）
function toolResponse(echo: string) {
  const json = JSON.stringify({ echo })
  const mid = Math.floor(json.length / 2)
  return [
    { type: 'message_start', message: { id: 'm', usage: {} } },
    { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'tu_1', name: TOOL_NAME, input: {} } },
    { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: json.slice(0, mid) } },
    { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: json.slice(mid) } },
    { type: 'content_block_stop', index: 0 },
    { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: {} },
    { type: 'message_stop' }
  ]
}

describe('inject-loop', () => {
  describe('parseUpstreamEvents', () => {
    it('should rebuild text block and stop_reason', () => {
      const p = parseUpstreamEvents(textResponse('hello world'))
      expect(p.stopReason).toBe('end_turn')
      expect(p.blocks[0]).toMatchObject({ type: 'text', text: 'hello world' })
    })

    it('should accumulate tool_use input_json_delta and JSON.parse it', () => {
      const p = parseUpstreamEvents(toolResponse('hi there'))
      expect(p.stopReason).toBe('tool_use')
      const tu = p.blocks[0]
      expect(tu.type).toBe('tool_use')
      expect(tu.name).toBe(TOOL_NAME)
      expect(tu.input).toEqual({ echo: 'hi there' })
    })
  })

  describe('findInjectedCall', () => {
    it('should find the injected tool_use block', () => {
      const p = parseUpstreamEvents(toolResponse('x'))
      expect(findInjectedCall(p)?.name).toBe(TOOL_NAME)
    })

    it('should return undefined when no injected tool call', () => {
      const p = parseUpstreamEvents(textResponse('x'))
      expect(findInjectedCall(p)).toBeUndefined()
    })
  })

})

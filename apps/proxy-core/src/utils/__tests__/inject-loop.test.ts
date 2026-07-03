import {
  parseSSEText,
  parseUpstreamEvents,
  findProbeCall,
  mockProbeExecute,
  runInjectLoop
} from '../inject-loop.js'
import { PROBE_TOOL_NAME } from '../tool-injector.js'

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

// 构造一段调用 probe tool 的响应事件（input 分片传输）
function probeResponse(echo: string) {
  const json = JSON.stringify({ echo })
  const mid = Math.floor(json.length / 2)
  return [
    { type: 'message_start', message: { id: 'm', usage: {} } },
    { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'tu_1', name: PROBE_TOOL_NAME, input: {} } },
    { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: json.slice(0, mid) } },
    { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: json.slice(mid) } },
    { type: 'content_block_stop', index: 0 },
    { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: {} },
    { type: 'message_stop' }
  ]
}

describe('inject-loop', () => {
  describe('parseSSEText', () => {
    it('should collect data: line JSON, skip [DONE] and non-json', () => {
      const raw = 'event: message_stop\ndata: {"type":"message_stop"}\n\ndata: [DONE]\n\ndata: notjson\n\n'
      const events = parseSSEText(raw)
      expect(events).toEqual([{ type: 'message_stop' }])
    })
  })

  describe('parseUpstreamEvents', () => {
    it('should rebuild text block and stop_reason', () => {
      const p = parseUpstreamEvents(textResponse('hello world'))
      expect(p.stopReason).toBe('end_turn')
      expect(p.blocks[0]).toMatchObject({ type: 'text', text: 'hello world' })
    })

    it('should accumulate tool_use input_json_delta and JSON.parse it', () => {
      const p = parseUpstreamEvents(probeResponse('hi there'))
      expect(p.stopReason).toBe('tool_use')
      const tu = p.blocks[0]
      expect(tu.type).toBe('tool_use')
      expect(tu.name).toBe(PROBE_TOOL_NAME)
      expect(tu.input).toEqual({ echo: 'hi there' })
    })
  })

  describe('findProbeCall', () => {
    it('should find the probe tool_use block', () => {
      const p = parseUpstreamEvents(probeResponse('x'))
      expect(findProbeCall(p)?.name).toBe(PROBE_TOOL_NAME)
    })

    it('should return undefined when no probe call', () => {
      const p = parseUpstreamEvents(textResponse('x'))
      expect(findProbeCall(p)).toBeUndefined()
    })
  })

  describe('mockProbeExecute', () => {
    it('should echo input and instruct model not to call again', () => {
      const out = mockProbeExecute({ echo: 'abc' })
      expect(out).toContain('abc')
      expect(out).toContain(PROBE_TOOL_NAME)
    })
  })

  describe('runInjectLoop', () => {
    it('should execute probe, append messages, and return final text on end_turn', async () => {
      const body = { messages: [{ role: 'user', content: 'do __PROBE__' }] }
      let call = 0
      const result = await runInjectLoop({
        events: probeResponse('echoed'),
        body,
        callUpstream: async (b) => {
          call++
          // 第二次调用返回最终文本
          return textResponse('final answer')
        }
      })
      expect(result.text).toBe('final answer')
      expect(result.iterations).toBe(1)
      expect(result.stoppedByLimit).toBe(false)
      expect(call).toBe(1)
      // messages 被追加了 assistant(tool_use) + user(tool_result)
      expect(body.messages.length).toBe(3)
      expect(body.messages[1]).toMatchObject({ role: 'assistant' })
      expect(body.messages[2].content[0]).toMatchObject({ type: 'tool_result', tool_use_id: 'tu_1' })
    })

    it('should return immediately if first response is not a probe call', async () => {
      const body = { messages: [] as any[] }
      const result = await runInjectLoop({
        events: textResponse('direct'),
        body,
        callUpstream: async () => textResponse('should not be called')
      })
      expect(result.text).toBe('direct')
      expect(result.iterations).toBe(0)
      expect(body.messages.length).toBe(0)
    })

    it('should stop at maxIterations when model keeps calling probe (死循环护栏)', async () => {
      const body = { messages: [] as any[] }
      const result = await runInjectLoop({
        events: probeResponse('loop'),
        body,
        callUpstream: async () => probeResponse('loop again'), // 永远调 probe
        maxIterations: 2
      })
      expect(result.stoppedByLimit).toBe(true)
      expect(result.iterations).toBe(2)
    })
  })
})

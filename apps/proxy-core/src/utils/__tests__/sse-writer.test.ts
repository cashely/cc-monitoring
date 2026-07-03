import { writeSSEEvent, writeTextAsSSE, shouldMock } from '../sse-writer.js'
import type { ServerResponse } from 'http'

// 收集 write 调用的 mock ServerResponse
function mockRaw() {
  const writes: string[] = []
  const raw = {
    write: (chunk: string) => {
      writes.push(chunk)
      return true
    }
  } as unknown as ServerResponse
  return { raw, writes }
}

// 从 write 出的文本行解析回事件对象（Anthropic 双行格式：event: <type>\ndata: <json>\n\n）
function parseWrites(writes: string[]): any[] {
  return writes.map((w) => {
    const match = w.match(/^event: (.+)\ndata: (.+)\n\n$/)
    expect(match).not.toBeNull()
    const event = JSON.parse(match![2])
    expect(match![1]).toBe(event.type)
    return event
  })
}

describe('sse-writer', () => {
  describe('writeSSEEvent', () => {
    it('should format event as `event: <type>\\ndata: {json}\\n\\n`', () => {
      const { raw, writes } = mockRaw()
      writeSSEEvent(raw, { type: 'ping', n: 1 })
      expect(writes).toEqual(['event: ping\ndata: {"type":"ping","n":1}\n\n'])
    })
  })

  describe('writeTextAsSSE', () => {
    it('should emit events in correct order', () => {
      const { raw, writes } = mockRaw()
      writeTextAsSSE(raw, 'hello', 'msg_1')
      const events = parseWrites(writes)
      expect(events.map((e) => e.type)).toEqual([
        'message_start',
        'content_block_start',
        'content_block_delta',
        'content_block_stop',
        'message_delta',
        'message_stop'
      ])
    })

    it('should carry text in text_delta and keep message id consistent', () => {
      const { raw, writes } = mockRaw()
      writeTextAsSSE(raw, 'the answer', 'msg_abc')
      const events = parseWrites(writes)
      expect(events[0].message.id).toBe('msg_abc')
      expect(events[2].delta).toEqual({ type: 'text_delta', text: 'the answer' })
      expect(events[4].delta.stop_reason).toBe('end_turn')
    })

    it('should use index 0 for the single text block', () => {
      const { raw, writes } = mockRaw()
      writeTextAsSSE(raw, 'x', 'msg_1')
      const events = parseWrites(writes)
      expect(events[1].index).toBe(0)
      expect(events[2].index).toBe(0)
      expect(events[3].index).toBe(0)
    })
  })

  describe('shouldMock', () => {
    it('should return true when last user message (string) contains __MOCK__', () => {
      expect(shouldMock({ messages: [{ role: 'user', content: 'run __MOCK__ now' }] })).toBe(true)
    })

    it('should return true when last user message (blocks) contains __MOCK__', () => {
      const body = {
        messages: [{ role: 'user', content: [{ type: 'text', text: 'please __MOCK__' }] }]
      }
      expect(shouldMock(body)).toBe(true)
    })

    it('should only inspect the last user message', () => {
      const body = {
        messages: [
          { role: 'user', content: '__MOCK__' },
          { role: 'assistant', content: 'ok' },
          { role: 'user', content: 'normal request' }
        ]
      }
      expect(shouldMock(body)).toBe(false)
    })

    it('should return false without magic word', () => {
      expect(shouldMock({ messages: [{ role: 'user', content: 'hello' }] })).toBe(false)
    })

    it('should return false for malformed body', () => {
      expect(shouldMock({})).toBe(false)
      expect(shouldMock(null)).toBe(false)
      expect(shouldMock({ messages: 'nope' })).toBe(false)
    })
  })
})

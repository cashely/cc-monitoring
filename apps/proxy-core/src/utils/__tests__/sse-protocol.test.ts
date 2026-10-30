import {
  createSSEDecoder,
  createEventDecoder,
  encodeSSEFrame,
  type SSEFrame
} from '../sse-protocol.js'

// 收集分发帧的辅助
function collectFrames(): { frames: SSEFrame[]; decoder: ReturnType<typeof createSSEDecoder> } {
  const frames: SSEFrame[] = []
  const decoder = createSSEDecoder((frame) => frames.push(frame))
  return { frames, decoder }
}

describe('sse-protocol', () => {
  // 样例 1：单帧含 event: + data:
  it('1. 单帧含 event 和 data', () => {
    const { frames, decoder } = collectFrames()
    decoder.write('event: foo\ndata: {"a":1}\n\n')
    expect(frames).toEqual([
      { event: 'foo', data: ['{"a":1}'], id: undefined }
    ])
  })

  // 样例 2：仅 data:（event 为 undefined）
  it('2. 仅 data，event 缺省为 undefined', () => {
    const { frames, decoder } = collectFrames()
    decoder.write('data: {"b":2}\n\n')
    expect(frames).toEqual([
      { event: undefined, data: ['{"b":2}'], id: undefined }
    ])
  })

  // 样例 3：一个 data 行切成 3 个 chunk（残帧缓冲）
  it('3. data 行跨 3 个 chunk 恰好得到一帧', () => {
    const { frames, decoder } = collectFrames()
    decoder.write('dat')
    expect(frames).toHaveLength(0)
    decoder.write('a: {"x')
    expect(frames).toHaveLength(0)
    decoder.write('":1}\n\n')
    expect(frames).toEqual([
      { event: undefined, data: ['{"x":1}'], id: undefined }
    ])
  })

  // 样例 4：CRLF 行尾 + 空行分帧
  it('4. CRLF 行尾与空行分帧', () => {
    const { frames, decoder } = collectFrames()
    decoder.write('event: ping\r\ndata: {"y":2}\r\n\r\n')
    expect(frames).toEqual([
      { event: 'ping', data: ['{"y":2}'], id: undefined }
    ])
  })

  // 样例 5：同一帧内多行 data:，数组保留两行，消费 join('\n') 正确
  it('5. 多行 data 逐行保留且 join 正确', () => {
    const { frames, decoder } = collectFrames()
    decoder.write('data: line1\ndata: line2\n\n')
    expect(frames).toHaveLength(1)
    expect(frames[0].data).toEqual(['line1', 'line2'])
    expect(frames[0].data.join('\n')).toBe('line1\nline2')
  })

  // 样例 6：注释行不产生帧
  it('6. 注释行被忽略不产生帧', () => {
    const { frames, decoder } = collectFrames()
    decoder.write(': ping\n\n')
    expect(frames).toHaveLength(0)
    // 注释与真实帧混合时仅真实帧分发
    decoder.write(': keep-alive\ndata: {"r":1}\n\n')
    expect(frames).toEqual([
      { event: undefined, data: ['{"r":1}'], id: undefined }
    ])
  })

  // 样例 7：data: [DONE] → onDone 触发、onEvent 不触发
  it('7. [DONE] 仅触发 onDone', () => {
    const events: any[] = []
    let doneCount = 0
    const decoder = createEventDecoder(
      (e) => events.push(e),
      () => { doneCount++ }
    )
    decoder.write('data: [DONE]\n\n')
    expect(events).toHaveLength(0)
    expect(doneCount).toBe(1)
  })

  // 样例 8：非 JSON data → onEvent 不触发、不抛错
  it('8. 非 JSON data 静默跳过', () => {
    const events: any[] = []
    const decoder = createEventDecoder((e) => events.push(e))
    expect(() => {
      decoder.write('data: not-json\n\n')
    }).not.toThrow()
    expect(events).toHaveLength(0)
  })

  // 样例 9：末尾帧无尾空行，write 不触发，end() 后恰好一帧
  it('9. end() 输出末尾无空行的残留帧', () => {
    const { frames, decoder } = collectFrames()
    decoder.write('data: {"z":9}')
    expect(frames).toHaveLength(0)
    decoder.end()
    expect(frames).toEqual([
      { event: undefined, data: ['{"z":9}'], id: undefined }
    ])
  })

  // 样例 10：id: 行保留在帧 id 字段
  it('10. id 字段保留在帧上', () => {
    const { frames, decoder } = collectFrames()
    decoder.write('id: e1\ndata: {"i":1}\n\n')
    expect(frames).toEqual([
      { event: undefined, data: ['{"i":1}'], id: 'e1' }
    ])
  })

  // 样例 11：encodeSSEFrame → createSSEDecoder 往返一致（有/无 event）
  it('11. encode/decode 往返帧内容一致（有 event 和无 event）', () => {
    const withEvent = encodeSSEFrame({ event: 'foo', data: '{"x":1}' })
    const d1 = collectFrames()
    d1.decoder.write(withEvent)
    expect(d1.frames).toEqual([
      { event: 'foo', data: ['{"x":1}'], id: undefined }
    ])

    const withoutEvent = encodeSSEFrame({ data: '{"x":2}' })
    const d2 = collectFrames()
    d2.decoder.write(withoutEvent)
    expect(d2.frames).toEqual([
      { event: undefined, data: ['{"x":2}'], id: undefined }
    ])
  })
})

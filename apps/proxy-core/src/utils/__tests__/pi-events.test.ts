import {
  createPiEventEmitter,
  isAssistantMessage,
  extractAssistantDelta,
  extractToolResultText,
  type PiSessionEvent,
} from '../pi-events.js'

// 合成原始 pi SDK 事件的小构造器
const messageStart = (role: string) => ({ type: 'message_start', message: { role } })
const messageEnd = (role: string) => ({ type: 'message_end', message: { role } })
const update = (ae: any) => ({ type: 'message_update', assistantMessageEvent: ae })
const textDelta = (delta: any) => update({ type: 'text_delta', delta })
const thinkingDelta = (delta: any) => update({ type: 'thinking_delta', delta })
const toolStart = (over: any = {}) => ({
  type: 'tool_execution_start',
  toolCallId: 'call-1',
  toolName: 'read_source',
  args: { topic: 'x' },
  ...over,
})
const toolEnd = (over: any = {}) => ({
  type: 'tool_execution_end',
  toolCallId: 'call-1',
  toolName: 'read_source',
  result: { content: [{ type: 'text', text: 'ok' }] },
  ...over,
})

function collect(): { events: PiSessionEvent[]; write: (ev: unknown) => void } {
  const events: PiSessionEvent[] = []
  const { write } = createPiEventEmitter((ev) => events.push(ev))
  return { events, write }
}

describe('pi-events 纯 helper', () => {
  test('isAssistantMessage：只认 assistant 角色', () => {
    expect(isAssistantMessage(messageStart('assistant'))).toBe(true)
    expect(isAssistantMessage(messageEnd('assistant'))).toBe(true)
    expect(isAssistantMessage(messageStart('user'))).toBe(false)
    expect(isAssistantMessage(messageEnd('toolResult'))).toBe(false)
    expect(isAssistantMessage({ message: {} })).toBe(false)
    expect(isAssistantMessage(null)).toBe(false)
  })

  test('extractAssistantDelta：text / thinking 解包，其余 null', () => {
    expect(extractAssistantDelta(textDelta('abc'))).toEqual({ kind: 'text', delta: 'abc' })
    expect(extractAssistantDelta(thinkingDelta('嗯'))).toEqual({ kind: 'thinking', delta: '嗯' })
    // 非 string delta
    expect(extractAssistantDelta(textDelta(123))).toBeNull()
    expect(extractAssistantDelta(thinkingDelta(null))).toBeNull()
    // 其他 ae.type
    expect(extractAssistantDelta(update({ type: 'text_start', delta: 'x' }))).toBeNull()
    expect(extractAssistantDelta(update({ type: 'thinking_end' }))).toBeNull()
    expect(extractAssistantDelta(update(undefined))).toBeNull()
    // 非 message_update
    expect(extractAssistantDelta({ type: 'other' })).toBeNull()
    expect(extractAssistantDelta(null)).toBeNull()
  })

  test('extractToolResultText：多段 text 拼接，无 content 为空串', () => {
    expect(extractToolResultText({ content: [
      { type: 'text', text: 'a' },
      { type: 'text', text: 'b' },
    ] })).toBe('a\nb')
    // 非数组 / 缺失
    expect(extractToolResultText({})).toBe('')
    expect(extractToolResultText(null)).toBe('')
    expect(extractToolResultText({ content: 'nope' })).toBe('')
  })
})

describe('createPiEventEmitter', () => {
  test('非 assistant 的 message_start / message_end 被忽略', () => {
    const { events, write } = collect()
    write(messageStart('user'))
    write(messageEnd('user'))
    write(messageStart('toolResult'))
    write(messageEnd('toolResult'))
    expect(events).toEqual([])
  })

  test('round 1-based：首轮 roundIndex=1，第二轮=2，end 与 start 索引一致', () => {
    const { events, write } = collect()
    write(messageStart('assistant'))
    write(messageEnd('assistant'))
    write(messageStart('assistant'))
    write(messageEnd('assistant'))
    expect(events).toEqual([
      { type: 'round_start', roundIndex: 1 },
      { type: 'round_end', roundIndex: 1 },
      { type: 'round_start', roundIndex: 2 },
      { type: 'round_end', roundIndex: 2 },
    ])
  })

  test('text_delta / thinking_delta 解包；无效 delta 与其他 ae.type 忽略', () => {
    const { events, write } = collect()
    write(textDelta('Hello '))
    write(thinkingDelta('想想'))
    write(textDelta(42))
    write(update({ type: 'text_start', delta: 'ignored' }))
    expect(events).toEqual([
      { type: 'text_delta', content: 'Hello ' },
      { type: 'thinking_delta', content: '想想' },
    ])
  })

  test('tool_start 字段透传', () => {
    const { events, write } = collect()
    write(toolStart({ toolName: 'add_topic', args: { slug: 's', tags: ['a'] } }))
    expect(events).toEqual([{
      type: 'tool_start',
      toolCallId: 'call-1',
      toolName: 'add_topic',
      args: { slug: 's', tags: ['a'] },
    }])
  })

  test('tool_end：durationMs 缺失为 0、有值透传、isError 布尔化、多段 text 拼接、无 content 为空串', () => {
    const { events, write } = collect()
    // 缺 durationMs / isError
    write(toolEnd({
      result: { content: [
        { type: 'text', text: 'part1' },
        { type: 'text', text: 'part2' },
      ] },
    }))
    // 有 durationMs、isError 真值
    write(toolEnd({
      toolCallId: 'call-2',
      toolName: 'add_topic',
      isError: 1,
      durationMs: 88,
      result: { content: [{ type: 'text', text: 'err' }] },
    }))
    // 无 content
    write(toolEnd({ toolCallId: 'call-3', result: {} }))

    expect(events).toEqual([
      { type: 'tool_end', toolCallId: 'call-1', toolName: 'read_source', isError: false, durationMs: 0, result: 'part1\npart2' },
      { type: 'tool_end', toolCallId: 'call-2', toolName: 'add_topic', isError: true, durationMs: 88, result: 'err' },
      { type: 'tool_end', toolCallId: 'call-3', toolName: 'read_source', isError: false, durationMs: 0, result: '' },
    ])
  })

  test('未知/其他事件类型忽略（含 agent_end）', () => {
    const { events, write } = collect()
    write({ type: 'agent_end' })
    write({ type: 'something_else', foo: 1 })
    write(null)
    expect(events).toEqual([])
  })

  test('initialIndex：首轮自增在初始值之上继续（initialIndex=2 → roundIndex=3）', () => {
    const events: PiSessionEvent[] = []
    const { write } = createPiEventEmitter((ev) => events.push(ev), { initialIndex: 2 })
    write(messageStart('assistant'))
    write(messageEnd('assistant'))
    expect(events).toEqual([
      { type: 'round_start', roundIndex: 3 },
      { type: 'round_end', roundIndex: 3 },
    ])
  })

  test('onIndexChange：以自增后的新值被调用；回调抛错不导致 write 抛错', () => {
    const seen: number[] = []
    const events: PiSessionEvent[] = []
    const { write } = createPiEventEmitter(
      (ev) => events.push(ev),
      {
        initialIndex: 1,
        onIndexChange: (n) => {
          seen.push(n)
          throw new Error('callback boom')
        },
      },
    )
    expect(() => write(messageStart('assistant'))).not.toThrow()
    expect(seen).toEqual([2])
    // 回调在 try 内、emit 之前，抛错被吞不波及 write；后续事件仍正常映射
    expect(events).toEqual([])
    write(messageEnd('assistant'))
    expect(events).toEqual([{ type: 'round_end', roundIndex: 2 }])
  })

  test('emit 抛错不导致 write 抛错', () => {
    const throwing = createPiEventEmitter((): void => {
      throw new Error('emit boom')
    })
    expect(() => throwing.write(messageStart('assistant'))).not.toThrow()
    expect(() => throwing.write(textDelta('x'))).not.toThrow()
    expect(() => throwing.write(toolStart())).not.toThrow()
    expect(() => throwing.write(toolEnd())).not.toThrow()
  })
})

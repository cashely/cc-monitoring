// pi-events: pi SDK 原始事件 → 会话领域事件的映射原语。
// learn orchestrator / chat SSE / runJsonPrompt 三处订阅共用同一套映射规则。
//
// "轮次" = 一次 assistant 交互（assistant message_start → message_end），
// 轮次索引 1-based。

/** 会话领域事件：与 SSE data 帧 payload 同形（type 字符串固定） */
export type PiSessionEvent =
  | { type: 'round_start'; roundIndex: number }
  | { type: 'round_end'; roundIndex: number }
  | { type: 'text_delta'; content: string }
  | { type: 'thinking_delta'; content: string }
  | { type: 'tool_start'; toolCallId: string; toolName: string; args: unknown }
  | { type: 'tool_end'; toolCallId: string; toolName: string; isError: boolean; durationMs: number; result: string }

/**
 * 是否 assistant 消息边界（message_start / message_end 分支内调用）。
 * message_start 对 user / assistant / toolResult 三种消息都会触发，
 * 只有 assistant 对应一次 LLM 回复轮次。
 */
export function isAssistantMessage(ev: any): boolean {
  return ev?.message?.role === 'assistant'
}

/**
 * 从 message_update 事件解包 assistant 流 delta：
 * ae.type 为 text_delta / thinking_delta 且 delta 为 string 时返回，否则 null。
 */
export function extractAssistantDelta(ev: any): { kind: 'text' | 'thinking'; delta: string } | null {
  if (ev?.type !== 'message_update') return null
  const ae = ev.assistantMessageEvent
  if ((ae?.type === 'text_delta' || ae?.type === 'thinking_delta') && typeof ae.delta === 'string') {
    return { kind: ae.type === 'text_delta' ? 'text' : 'thinking', delta: ae.delta }
  }
  return null
}

/**
 * 提取工具结果文本：result.content 为数组时，各项 type === 'text' 取 text
 * （非 text 项以空串占位），以 '\n' 拼接；否则 ''。
 */
export function extractToolResultText(result: any): string {
  if (!Array.isArray(result?.content)) return ''
  return result.content
    .map((c: any) => (c?.type === 'text' ? c.text : ''))
    .join('\n')
}

export interface PiEventWriter {
  /** 喂入一条 pi SDK 原始事件；映射/回调异常不外泄 */
  write(rawEvent: unknown): void
}

export interface PiEventEmitterOptions {
  /** 初始轮次计数（复用 session 时传入上次累计值），默认 0 */
  initialIndex?: number
  /** 计数递增时回调，供调用方持久化到 session */
  onIndexChange?: (roundIndex: number) => void
}

/**
 * 有状态映射器：内部维护 1-based 轮次计数（assistant message_start 先自增再发
 * round_start，message_end 带当前值），把原始事件映射为 PiSessionEvent 交给 emit。
 * agent_end 等终态事件不在这里处理（由调用方自行监听）。
 *
 * 跨连接复用语义：同一 pi session 可能被多个 SSE 连接先后复用（多次追问），
 * 调用方应通过 initialIndex 传入上次累计的轮次、并在 onIndexChange 中持久化新值，
 * 否则每个连接的 roundIndex 都会从 1 重来，导致前端按 roundIndex 去重时串轮。
 */
export function createPiEventEmitter(
  emit: (ev: PiSessionEvent) => void,
  options?: PiEventEmitterOptions,
): PiEventWriter {
  let roundIndex = options?.initialIndex ?? 0
  return {
    write(rawEvent: unknown) {
      try {
        const ev = rawEvent as any
        if (ev.type === 'message_start') {
          if (isAssistantMessage(ev)) {
            roundIndex += 1
            options?.onIndexChange?.(roundIndex)
            emit({ type: 'round_start', roundIndex })
          }
        } else if (ev.type === 'message_end') {
          if (isAssistantMessage(ev)) {
            emit({ type: 'round_end', roundIndex })
          }
        } else if (ev.type === 'message_update') {
          const d = extractAssistantDelta(ev)
          if (d) {
            emit(
              d.kind === 'text'
                ? { type: 'text_delta', content: d.delta }
                : { type: 'thinking_delta', content: d.delta },
            )
          }
        } else if (ev.type === 'tool_execution_start') {
          emit({
            type: 'tool_start',
            toolCallId: ev.toolCallId,
            toolName: ev.toolName,
            args: ev.args,
          })
        } else if (ev.type === 'tool_execution_end') {
          emit({
            type: 'tool_end',
            toolCallId: ev.toolCallId,
            toolName: ev.toolName,
            isError: !!ev.isError,
            durationMs: ev.durationMs ?? 0,
            result: extractToolResultText(ev.result),
          })
        }
        // 其他事件（agent_end / 未知类型）忽略
      } catch {
        // 映射或 emit 抛错不影响 SDK 事件分发（参照 orchestrator 既有约定）
      }
    },
  }
}

/**
 * SSE 帧协议：字节流 ↔ SSE 帧 的唯一知识收敛点。
 *
 * - SSE 帧（frame）：字节流按 SSE 规范切分出的单位，由若干字段行
 *   （event: / data: / id: / 注释 / 空行分发）组成。
 * - SSE 事件（event）：SSE 帧的 data 字段解析出的 JSON 消息。
 *
 * 解析遵循 HTML spec 的 event stream 语义：残帧缓冲、LF/CRLF/CR 行尾、
 * 空行分发、字段行去掉恰好一个可选空格。
 */

export interface SSEFrame {
  event?: string
  data: string[]
  id?: string
}

export interface SSEDecoder {
  write(chunk: Buffer | string): void
  end(): void
}

/** 创建 SSE 帧解码器：每分发一个完整 SSE 帧回调一次 */
export function createSSEDecoder(onFrame: (frame: SSEFrame) => void): SSEDecoder {
  // 残帧缓冲：跨 chunk 的不完整行
  let leftover = ''
  let event: string | undefined
  let data: string[] = []
  let id: string | undefined

  /** 分发当前帧：至少含一个 data 行才回调；分发后重置字段状态 */
  function dispatch(): void {
    if (data.length > 0) {
      onFrame({ event, data, id })
    }
    event = undefined
    id = undefined
    data = []
  }

  /** 处理一个完整行 */
  function handleLine(line: string): void {
    // 空行 = 一帧分发
    if (line === '') {
      dispatch()
      return
    }

    // 以冒号开头的行是注释，忽略
    if (line.startsWith(':')) return

    let field: string
    let value: string
    const colon = line.indexOf(':')
    if (colon === -1) {
      field = line
      value = ''
    } else {
      field = line.slice(0, colon)
      value = line.slice(colon + 1)
      // 去掉字段值行首恰好一个可选空格
      if (value.startsWith(' ')) value = value.slice(1)
    }

    if (field === 'event') {
      event = value
    } else if (field === 'data') {
      // 多行 data 逐行保留，消费时用 \n join
      data.push(value)
    } else if (field === 'id') {
      id = value
    }
  }

  /** 消费文本中所有完整行，末段保留为残帧 */
  function feed(text: string): void {
    // CRLF 与单独 CR 统一为 LF
    const normalized = text.replace(/\r\n?/g, '\n')
    const lines = normalized.split('\n')
    leftover = lines.pop() || ''
    for (const line of lines) handleLine(line)
  }

  return {
    write(chunk: Buffer | string): void {
      const chunkText = typeof chunk === 'string' ? chunk : chunk.toString('utf-8')
      feed(leftover + chunkText)
    },

    end(): void {
      // 先按残帧缓冲补一次切行
      if (leftover !== '') {
        const normalized = leftover.replace(/\r\n?/g, '\n')
        leftover = ''
        for (const line of normalized.split('\n')) handleLine(line)
      }
      // 再对缓冲中尚未分发的非空帧做一次分发（末尾无空行也能输出最后一帧）
      if (data.length > 0) dispatch()
      // 清空状态
      leftover = ''
      event = undefined
      id = undefined
      data = []
    }
  }
}

/**
 * 编码单个 SSE 帧。data 为已序列化好的字符串（调用方负责 JSON.stringify）。
 * 有 event：`event: <event>\ndata: <data>\n\n`；无 event：`data: <data>\n\n`。
 */
export function encodeSSEFrame(args: { event?: string; data: string }): string {
  const prefix = args.event !== undefined ? `event: ${args.event}\n` : ''
  return `${prefix}data: ${args.data}\n\n`
}

/**
 * 创建 SSE 事件解码器：帧 data 用 \n join 后，[DONE] 触发 onDone，
 * 其余尝试 JSON.parse 成功后触发 onEvent，解析失败静默跳过。
 */
export function createEventDecoder(
  onEvent: (event: any) => void,
  onDone?: () => void
): SSEDecoder {
  return createSSEDecoder((frame) => {
    const text = frame.data.join('\n')
    if (text.trim() === '[DONE]') {
      onDone?.()
      return
    }
    try {
      onEvent(JSON.parse(text))
    } catch {
      // 非 JSON data 静默跳过
    }
  })
}

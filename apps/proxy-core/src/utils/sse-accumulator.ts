import { Transform, TransformCallback } from 'stream'

export class SSEAccumulator extends Transform {
  events: unknown[] = []
  requestId: string
  private leftover: string = ''

  constructor(requestId: string) {
    super({ decodeStrings: true })
    this.requestId = requestId
  }

  _transform(chunk: Buffer, encoding: string, callback: TransformCallback) {
    const text = this.leftover + chunk.toString('utf-8')
    const lines = text.split('\n')

    // Keep last incomplete line for next chunk
    this.leftover = lines.pop() || ''

    // Parse complete lines
    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const data = line.slice(6)
        try {
          this.events.push(JSON.parse(data))
        } catch {
          this.events.push({ raw: data })
        }
      }
    }

    this.push(chunk)
    callback()
  }

  _flush(callback: TransformCallback) {
    // Process any remaining leftover
    if (this.leftover.startsWith('data: ')) {
      const data = this.leftover.slice(6)
      try {
        this.events.push(JSON.parse(data))
      } catch {
        this.events.push({ raw: data })
      }
    }
    this.leftover = ''
    callback()
  }
}

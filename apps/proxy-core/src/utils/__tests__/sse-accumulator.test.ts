import { SSEAccumulator } from '../sse-accumulator.js'
import { Readable } from 'stream'

describe('SSEAccumulator', () => {
  it('should parse SSE events from chunk', async () => {
    const accumulator = new SSEAccumulator('test-123')
    const input = 'data: {"type":"test","data":"hello"}\n\n'
    const stream = Readable.from([input])

    const result = await new Promise((resolve) => {
      stream.pipe(accumulator)
      accumulator.on('finish', () => {
        resolve(accumulator.events)
      })
    })

    expect(result).toEqual([
      { type: 'test', data: 'hello' }
    ])
  })

  it('should accumulate multiple events', async () => {
    const accumulator = new SSEAccumulator('test-456')
    const input1 = 'data: {"event":"start"}\n\n'
    const input2 = 'data: {"event":"delta"}\n\n'
    const stream = Readable.from([input1, input2])

    const result = await new Promise((resolve) => {
      stream.pipe(accumulator)
      accumulator.on('finish', () => {
        resolve(accumulator.events)
      })
    })

    expect(result).toEqual([
      { event: 'start' },
      { event: 'delta' }
    ])
  })

  it('should handle invalid JSON as raw data', async () => {
    const accumulator = new SSEAccumulator('test-789')
    const input = 'data: not-json\n\n'
    const stream = Readable.from([input])

    const result = await new Promise((resolve) => {
      stream.pipe(accumulator)
      accumulator.on('finish', () => {
        resolve(accumulator.events)
      })
    })

    expect(result).toEqual([
      { raw: 'not-json' }
    ])
  })

  it('should handle SSE events split across multiple chunks', async () => {
    const accumulator = new SSEAccumulator('test-split')
    // Simulate a single SSE event split across 3 chunks
    const chunk1 = 'da'
    const chunk2 = 'ta: {"even'
    const chunk3 = 't":"split"}\n\n'

    const stream = Readable.from([chunk1, chunk2, chunk3])

    const result = await new Promise((resolve) => {
      stream.pipe(accumulator)
      accumulator.on('finish', () => {
        resolve(accumulator.events)
      })
    })

    expect(result).toEqual([
      { event: 'split' }
    ])
  })

  it('should handle multiple events split across chunks', async () => {
    const accumulator = new SSEAccumulator('test-multi-split')
    // First event complete, second event split, third event trailing at stream end
    const chunk1 = 'data: {"a":1}\n\ndata: {"b'
    const chunk2 = '":2}\n\ndata: {"c":3}'

    const stream = Readable.from([chunk1, chunk2])

    const result = await new Promise((resolve) => {
      stream.pipe(accumulator)
      accumulator.on('finish', () => {
        resolve(accumulator.events)
      })
    })

    expect(result).toEqual([
      { a: 1 },
      { b: 2 },
      { c: 3 }
    ])
  })
})

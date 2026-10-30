import { createStreamTransformer } from '../openai-converter.js'

describe('createStreamTransformer', () => {
  it('收到 [DONE] 后正常关闭且不产生 error（不 double callback）', (done) => {
    const stream = createStreamTransformer('test-model')
    let output = ''
    let errored: any = null
    let closed = false

    stream.on('data', (chunk: Buffer) => { output += chunk.toString() })
    stream.on('error', (err: Error) => { errored = err })
    stream.on('close', () => { closed = true })

    // 正常帧：含 delta.content
    stream.write('data: {"choices":[{"delta":{"content":"hi"}}]}\n\n')
    // finish_reason 帧 + [DONE] 放同一 chunk
    stream.write('data: {"choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n')

    setTimeout(() => {
      // double callback 若将来被 Node 升级为抛错，会在这里以 error/未关闭暴露
      expect(errored).toBeNull()
      expect(closed).toBe(true)
      // 收尾帧中存在 message_delta（携带 stop_reason）
      expect(output).toContain('message_delta')
      expect(output).toContain('stop_reason')
      done()
    }, 100)
  })
})

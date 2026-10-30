// pi-coding-agent 为 ESM-only（无 require 导出），jest CJS 无法加载；
// mock 掉以加载真实 pi-runtime 模块测试纯函数 + runJsonPrompt 中止语义
// （同 pi-browser-tools.test.ts 的 typebox mock 做法）
jest.mock(
  '@earendil-works/pi-coding-agent',
  () => {
    // fake session：模拟真实 SDK——abort 后在途 prompt/waitForIdle 正常 resolve
    const fakeSession = {
      sessionId: 'fake-reconcile',
      subscribe: jest.fn(() => () => {}),
      prompt: jest.fn(async () => {}),
      waitForIdle: jest.fn(async () => {}),
      abort: jest.fn(async () => {}),
    }
    return {
      createWriteToolDefinition: () => ({}),
      createAgentSession: jest.fn(async () => ({ session: fakeSession })),
      DefaultResourceLoader: function (this: any) {
        this.reload = async () => {}
      },
      ModelRuntime: {
        create: jest.fn(async () => ({
          registerProvider: jest.fn(),
          getModel: () => ({}),
        })),
      },
      fakeSession,
    }
  },
  { virtual: true },
)

import { extractJsonObject, runJsonPrompt } from '../pi-runtime.js'

const { fakeSession } = jest.requireMock('@earendil-works/pi-coding-agent') as {
  fakeSession: {
    abort: jest.Mock
    prompt: jest.Mock
    waitForIdle: jest.Mock
  }
}

test('extractJsonObject: 从含 prose/代码围栏文本取出第一个 JSON 对象', () => {
  const raw = 'Here:\n```json\n{"a":1,"b":[2,3]}\n```\ndone'
  expect(extractJsonObject(raw)).toEqual({ a: 1, b: [2, 3] })
})
test('extractJsonObject: 无 JSON → throw', () => {
  expect(() => extractJsonObject('no json here')).toThrow(/no json object/)
})

test('runJsonPrompt：abort 后 prompt/waitForIdle 正常 resolve → 靠 combined.aborted 检查 reject，不返回 JSON', async () => {
  const external = new AbortController()
  external.abort()

  // combined 因外部 signal 立即 abort，bindAbort 立即调 session.abort()；不等 300s 超时
  await expect(
    runJsonPrompt({ port: 1, instructions: 'return json', prompt: '{}', signal: external.signal }),
  ).rejects.toThrow(/json prompt 已中止/)

  expect(fakeSession.abort).toHaveBeenCalledTimes(1)
  // prompt 确实被调用且正常 resolve（证明不是靠 prompt reject）
  expect(fakeSession.prompt).toHaveBeenCalledTimes(1)
  expect(fakeSession.waitForIdle).toHaveBeenCalledTimes(1)
})

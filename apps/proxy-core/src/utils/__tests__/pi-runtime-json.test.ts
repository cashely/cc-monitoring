// pi-coding-agent 为 ESM-only（无 require 导出），jest CJS 无法加载；
// mock 掉以加载真实 pi-runtime 模块测试纯函数（同 pi-browser-tools.test.ts 的 typebox mock 做法）
jest.mock(
  '@earendil-works/pi-coding-agent',
  () => ({ createWriteToolDefinition: () => ({}) }),
  { virtual: true },
)

import { extractJsonObject } from '../pi-runtime.js'

test('extractJsonObject: 从含 prose/代码围栏文本取出第一个 JSON 对象', () => {
  const raw = 'Here:\n```json\n{"a":1,"b":[2,3]}\n```\ndone'
  expect(extractJsonObject(raw)).toEqual({ a: 1, b: [2, 3] })
})
test('extractJsonObject: 无 JSON → throw', () => {
  expect(() => extractJsonObject('no json here')).toThrow(/no json object/)
})

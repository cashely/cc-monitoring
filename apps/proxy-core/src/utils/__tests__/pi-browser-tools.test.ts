// pi-browser-tools 顶层 import typebox（ESM-only），jest 无法 transform；mock 掉以加载真实模块测试纯函数
jest.mock('typebox', () => ({
  Type: new Proxy({}, { get: () => () => ({}) }),
}))

import { stripCliBanners } from '../pi-browser-tools.js'

describe('stripCliBanners', () => {
  it('横幅行在 JSON 行之前时剥离，JSON.parse 成功', () => {
    const input =
      '[ego-browser:notice] Ego Lite update is available: 1.2.3 -> 1.3.0\n{"url":"https://example.com","title":"Example"}'
    const out = stripCliBanners(input)
    const parsed = JSON.parse(out)
    expect(parsed.url).toBe('https://example.com')
    expect(parsed.title).toBe('Example')
  })

  it('横幅行在中间时该行被删除，其余行保留', () => {
    const input = 'line1\n[ego-browser:notice] update me\nline3'
    expect(stripCliBanners(input)).toBe('line1\nline3')
  })

  it('多条横幅行全部删除', () => {
    const input =
      '[ego-browser:notice] a\nreal1\n[ego-browser:notice] b\nreal2\n[ego-browser:notice] c'
    expect(stripCliBanners(input)).toBe('real1\nreal2')
  })

  it('没有横幅时输出与输入完全一致', () => {
    const input = '{"a":1}\n{"b":2}'
    expect(stripCliBanners(input)).toBe(input)
  })

  it('行内（非行首）包含横幅字样的行必须保留', () => {
    const input = '{"msg":"see [ego-browser:notice] inside value"}'
    expect(stripCliBanners(input)).toBe(input)
  })
})

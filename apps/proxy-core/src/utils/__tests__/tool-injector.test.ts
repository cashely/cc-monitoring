// mock 注册表：提供一个已启用的 fake tool，供 injectTools 读取
jest.mock('../../tools/index.js', () => ({
  enabledTools: () => [
    {
      name: '__test_tool',
      description: 'test tool with __PROBE__ marker',
      input_schema: { type: 'object', properties: { echo: { type: 'string' } }, required: ['echo'] },
      enabled: true,
      exec: () => 'ok'
    }
  ]
}))

import { injectTools } from '../tool-injector.js'

describe('tool-injector', () => {
  describe('injectTools', () => {
    it('should append enabled tools to the END of a non-empty tools array', () => {
      const body = { tools: [{ name: 'Read' }, { name: 'Write' }] }
      const injected = injectTools(body)
      expect(injected).toEqual(['__test_tool'])
      expect(body.tools.length).toBe(3)
      // 追加到末尾，前缀原工具顺序不变（保护 cache）
      expect(body.tools[0]).toEqual({ name: 'Read' })
      expect(body.tools[1]).toEqual({ name: 'Write' })
      expect((body.tools[2] as any).name).toBe('__test_tool')
    })

    it('should NOT inject when tools is empty (辅助请求)', () => {
      const body = { tools: [] }
      expect(injectTools(body)).toEqual([])
      expect(body.tools.length).toBe(0)
    })

    it('should NOT inject when tools is absent', () => {
      const body: any = { messages: [] }
      expect(injectTools(body)).toEqual([])
      expect(body.tools).toBeUndefined()
    })

    it('should be idempotent (不重复注入)', () => {
      const body = { tools: [{ name: 'Read' }] }
      expect(injectTools(body)).toEqual(['__test_tool'])
      expect(injectTools(body)).toEqual([])
      expect(body.tools.filter((t: any) => t.name === '__test_tool').length).toBe(1)
    })

    it('should handle malformed body safely', () => {
      expect(injectTools(null)).toEqual([])
      expect(injectTools({})).toEqual([])
      expect(injectTools({ tools: 'nope' })).toEqual([])
    })

    it('injected tool should only carry the function-call triple (no local metadata)', () => {
      const body = { tools: [{ name: 'Read' }] }
      injectTools(body)
      const tool = body.tools.find((t: any) => t.name === '__test_tool') as any
      expect(tool.input_schema.type).toBe('object')
      expect(tool.input_schema.required).toContain('echo')
      // enabled/exec 是本地元数据，不进请求体
      expect(tool.enabled).toBeUndefined()
      expect(tool.exec).toBeUndefined()
    })
  })
})

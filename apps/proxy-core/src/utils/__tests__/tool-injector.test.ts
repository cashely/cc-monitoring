import { injectProbeTool, PROBE_TOOL_NAME } from '../tool-injector.js'

describe('tool-injector', () => {
  describe('injectProbeTool', () => {
    it('should append probe tool to the END of a non-empty tools array', () => {
      const body = { tools: [{ name: 'Read' }, { name: 'Write' }] }
      const injected = injectProbeTool(body)
      expect(injected).toBe(true)
      expect(body.tools.length).toBe(3)
      // 追加到末尾，前缀原工具顺序不变（保护 cache）
      expect(body.tools[0]).toEqual({ name: 'Read' })
      expect(body.tools[1]).toEqual({ name: 'Write' })
      expect(body.tools[2].name).toBe(PROBE_TOOL_NAME)
    })

    it('should NOT inject when tools is empty (辅助请求)', () => {
      const body = { tools: [] }
      expect(injectProbeTool(body)).toBe(false)
      expect(body.tools.length).toBe(0)
    })

    it('should NOT inject when tools is absent', () => {
      const body: any = { messages: [] }
      expect(injectProbeTool(body)).toBe(false)
      expect(body.tools).toBeUndefined()
    })

    it('should be idempotent (不重复注入)', () => {
      const body = { tools: [{ name: 'Read' }] }
      expect(injectProbeTool(body)).toBe(true)
      expect(injectProbeTool(body)).toBe(false)
      expect(body.tools.filter((t: any) => t.name === PROBE_TOOL_NAME).length).toBe(1)
    })

    it('should handle malformed body safely', () => {
      expect(injectProbeTool(null)).toBe(false)
      expect(injectProbeTool({})).toBe(false)
      expect(injectProbeTool({ tools: 'nope' })).toBe(false)
    })

    it('injected probe tool should have a valid schema shape', () => {
      const body = { tools: [{ name: 'Read' }] }
      injectProbeTool(body)
      const probe = body.tools.find((t: any) => t.name === PROBE_TOOL_NAME) as any
      expect(probe.description).toContain('__PROBE__')
      expect(probe.input_schema.type).toBe('object')
      expect(probe.input_schema.required).toContain('echo')
    })
  })
})

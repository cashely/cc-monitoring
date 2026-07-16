// mock MCP manager：提供一个已启用的 fake MCP tool
jest.mock('../mcp-manager.js', () => ({
  mcpManager: {
    getMcpTools: () => [
      {
        name: '__test_mcp_tool',
        description: 'test MCP tool',
        input_schema: { type: 'object', properties: { echo: { type: 'string' } }, required: ['echo'] },
        enabled: true,
        exec: () => 'ok'
      }
    ]
  }
}))

import { injectMcpTools } from '../tool-injector.js'

describe('tool-injector', () => {
  describe('injectMcpTools', () => {
    it('should append MCP tools to the END of a non-empty tools array', () => {
      const body = { tools: [{ name: 'Read' }, { name: 'Write' }] }
      const injected = injectMcpTools(body)
      expect(injected).toEqual(['__test_mcp_tool'])
      expect(body.tools.length).toBe(3)
      expect(body.tools[0]).toEqual({ name: 'Read' })
      expect(body.tools[1]).toEqual({ name: 'Write' })
      expect((body.tools[2] as any).name).toBe('__test_mcp_tool')
    })

    it('should create tools array when absent', () => {
      const body: any = { messages: [] }
      const injected = injectMcpTools(body)
      expect(injected).toEqual(['__test_mcp_tool'])
      expect(Array.isArray(body.tools)).toBe(true)
      expect(body.tools.length).toBe(1)
    })

    it('should be idempotent (不重复注入)', () => {
      const body = { tools: [{ name: 'Read' }] }
      expect(injectMcpTools(body)).toEqual(['__test_mcp_tool'])
      expect(injectMcpTools(body)).toEqual([])
      expect(body.tools.filter((t: any) => t.name === '__test_mcp_tool').length).toBe(1)
    })

    it('should handle malformed body safely', () => {
      expect(injectMcpTools(null)).toEqual([])
      expect(injectMcpTools({})).toEqual([])
      expect(injectMcpTools({ tools: 'nope' })).toEqual([])
    })

    it('injected tool should only carry the function-call triple (no local metadata)', () => {
      const body = { tools: [{ name: 'Read' }] }
      injectMcpTools(body)
      const tool = body.tools.find((t: any) => t.name === '__test_mcp_tool') as any
      expect(tool.input_schema.type).toBe('object')
      expect(tool.input_schema.required).toContain('echo')
      expect(tool.enabled).toBeUndefined()
      expect(tool.exec).toBeUndefined()
    })
  })
})

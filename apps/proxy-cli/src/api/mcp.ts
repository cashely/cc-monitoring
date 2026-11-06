import type { McpServerWithStatus, McpServerInput } from '../types/mcp'

const API_BASE = '/ui/api'

export async function fetchMcpServers(): Promise<{ servers: McpServerWithStatus[] }> {
  const res = await fetch(`${API_BASE}/mcp/servers`)
  return res.json()
}

export async function createMcpServer(server: McpServerInput): Promise<{ success: boolean; server?: McpServerWithStatus; error?: string }> {
  const res = await fetch(`${API_BASE}/mcp/servers`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ server })
  })
  return res.json()
}

export async function updateMcpServer(id: number, input: Partial<McpServerInput>): Promise<{ success: boolean; server?: McpServerWithStatus; error?: string }> {
  const res = await fetch(`${API_BASE}/mcp/servers/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input)
  })
  return res.json()
}

export async function deleteMcpServer(id: number): Promise<{ success: boolean; error?: string }> {
  const res = await fetch(`${API_BASE}/mcp/servers/${id}`, {
    method: 'DELETE'
  })
  return res.json()
}

export async function reconnectMcpServer(id: number): Promise<{ success: boolean; error?: string }> {
  const res = await fetch(`${API_BASE}/mcp/servers/${id}/reconnect`, {
    method: 'POST'
  })
  return res.json()
}


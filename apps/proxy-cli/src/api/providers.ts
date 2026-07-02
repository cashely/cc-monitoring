import type { Provider, ProviderInput, ProviderSaveResult } from '../types/providers'

const API_BASE = '/ui/api'

export async function fetchProviders(): Promise<{ providers: Provider[] }> {
  const res = await fetch(`${API_BASE}/providers`)
  return res.json()
}

export async function saveProviders(providers: ProviderInput[]): Promise<ProviderSaveResult> {
  const res = await fetch(`${API_BASE}/providers`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ providers })
  })
  return res.json()
}

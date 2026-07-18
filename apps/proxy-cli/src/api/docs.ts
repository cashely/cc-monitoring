const API_BASE = '/ui/api'

export async function uploadDoc(file: File): Promise<{ success: boolean; path?: string; error?: string }> {
  const formData = new FormData()
  formData.append('file', file)

  const res = await fetch(`${API_BASE}/docs/upload`, {
    method: 'POST',
    body: formData
  })

  return res.json()
}

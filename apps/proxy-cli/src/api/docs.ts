const API_BASE = '/ui/api'

// 新契约：上传成功后直接返回转换好的 markdown 文本（不再由前端跑 agent）
export async function uploadDoc(file: File): Promise<{ success: boolean; path?: string; markdown?: string; error?: string }> {
  const formData = new FormData()
  formData.append('file', file)

  const res = await fetch(`${API_BASE}/docs/upload`, {
    method: 'POST',
    body: formData
  })

  return res.json()
}

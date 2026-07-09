import { loadConfig } from '../../config/index.js'

async function parseSSEStream(response: Response): Promise<number> {
  const reader = response.body!.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let exitCode = 0

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() || '' // Keep incomplete line in buffer

    let eventType = ''
    let eventData = ''

    for (const line of lines) {
      if (line.startsWith('event: ')) {
        eventType = line.slice(7)
      } else if (line.startsWith('data: ')) {
        eventData = line.slice(6)
      } else if (line === '') {
        // End of event
        if (eventType && eventData) {
          try {
            const data = JSON.parse(eventData)
            if (eventType === 'data') {
              if (data.type === 'stderr') {
                process.stderr.write(data.content)
              } else {
                process.stdout.write(data.content)
              }
            } else if (eventType === 'error') {
              console.error('\nError:', data.message)
            } else if (eventType === 'done') {
              exitCode = data.code ?? 0
            }
          } catch {
            // Ignore malformed JSON
          }
        }
        eventType = ''
        eventData = ''
      }
    }
  }

  return exitCode
}

async function checkServerReachable(baseUrl: string): Promise<boolean> {
  try {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 2000)
    const response = await fetch(`${baseUrl}/ui/api/status`, {
      signal: controller.signal
    })
    clearTimeout(timeoutId)
    return response.ok
  } catch {
    return false
  }
}

export async function execCommand(prompt: string): Promise<void> {
  // Load config
  const config = await loadConfig()
  const host = config.server.host === '0.0.0.0' || config.server.host === '::'
    ? '127.0.0.1'
    : config.server.host
  const baseUrl = `http://${host}:${config.server.port}`

  // Check if server is reachable
  const isReachable = await checkServerReachable(baseUrl)
  if (!isReachable) {
    console.error('Server not running. Use "ccm start" first.')
    process.exit(1)
  }

  // Build request
  const headers: Record<string, string> = {
    'Content-Type': 'application/json'
  }

  if (config.auth?.token) {
    headers['Authorization'] = `Bearer ${config.auth.token}`
  }

  try {
    const response = await fetch(`${baseUrl}/ui/api/exec`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        tool: 'claude',
        prompt,
        stream: true
      })
    })

    if (!response.ok) {
      const text = await response.text()
      let errorMsg = `Request failed with status ${response.status}`
      try {
        const json = JSON.parse(text)
        errorMsg = json.error || errorMsg
      } catch {
        errorMsg = text || errorMsg
      }
      console.error('Error:', errorMsg)
      process.exit(1)
    }

    const contentType = response.headers.get('content-type') || ''
    if (contentType.includes('text/event-stream')) {
      const exitCode = await parseSSEStream(response)
      process.exit(exitCode)
    } else {
      const result = await response.json()
      if (result.output) {
        process.stdout.write(result.output)
      }
      if (result.error) {
        process.stderr.write(result.error)
      }
      process.exit(result.success ? 0 : 1)
    }
  } catch (err: any) {
    console.error('Failed to execute command:', err.message)
    process.exit(1)
  }
}

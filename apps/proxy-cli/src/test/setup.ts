import { vi, expect } from 'vitest'
import * as matchers from '@testing-library/jest-dom/matchers'
import i18n from '../i18n'

expect.extend(matchers)

i18n.changeLanguage('zh')

// Mock WebSocket for tests
class MockWebSocket {
  static instances: MockWebSocket[] = []
  static CONNECTING = 0
  static OPEN = 1
  static CLOSING = 2
  static CLOSED = 3
  url: string
  onmessage: ((event: { data: string }) => void) | null = null
  onerror: ((event: Event) => void) | null = null
  onopen: (() => void) | null = null
  onclose: (() => void) | null = null
  readyState: number = 0

  constructor(url: string) {
    this.url = url
    MockWebSocket.instances.push(this)
  }

  send(data: string) {}
  close() {
    this.readyState = 3
    const idx = MockWebSocket.instances.indexOf(this)
    if (idx !== -1) MockWebSocket.instances.splice(idx, 1)
  }

  static reset() {
    MockWebSocket.instances = []
  }
}

vi.stubGlobal('WebSocket', MockWebSocket)

export { MockWebSocket }

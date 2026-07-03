import net from 'net'
import { waitForPort } from '../net'

// 加速测试：桩掉真实退避等待
jest.spyOn(global, 'setTimeout').mockImplementation(((fn: () => void) => {
  fn()
  return 0 as unknown as NodeJS.Timeout
}) as unknown as typeof setTimeout)

afterAll(() => {
  jest.restoreAllMocks()
})

describe('waitForPort', () => {
  it('returns true when the port is listening', async () => {
    const server = net.createServer()
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const port = (server.address() as net.AddressInfo).port

    const ok = await waitForPort('127.0.0.1', port)
    expect(ok).toBe(true)

    await new Promise<void>((resolve) => server.close(() => resolve()))
  })

  it('returns false when nothing listens after all attempts', async () => {
    // 端口 1 普通用户无法监听，连接必然失败
    const ok = await waitForPort('127.0.0.1', 1)
    expect(ok).toBe(false)
  })
})

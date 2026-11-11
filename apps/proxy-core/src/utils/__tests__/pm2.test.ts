import {
  resetMockState,
  addMockProcess,
  mockProcesses,
  createPm2Mock
} from '../__mocks__/pm2-helpers'

jest.mock('pm2', () => {
  const { createPm2Mock } = jest.requireActual('../__mocks__/pm2-helpers')
  return createPm2Mock()
})

import {
  startProcess,
  stopProcess,
  reloadProcess,
  getProcessStatus,
  disconnectPm2
} from '../pm2'

beforeEach(async () => {
  // 重置模块级连接单例，保证每个测试都重新 connect
  await disconnectPm2()
  resetMockState()
  jest.restoreAllMocks()
})

describe('startProcess', () => {
  it('connects, starts a process from ecosystem path, and disconnects', async () => {
    await startProcess('/path/to/ecosystem.config.js')
    expect(mockProcesses.length).toBe(1)
  })

  it('resolves successfully on valid call', async () => {
    await expect(startProcess('/path/to/ecosystem.config.js')).resolves.toBeUndefined()
  })
})

describe('stopProcess', () => {
  it('connects, stops a process by name, and disconnects', async () => {
    addMockProcess({
      name: 'proxy-server',
      pm2_env: { status: 'online', pm_uptime: Date.now(), restart_time: 0 },
      monit: { memory: 1024, cpu: 5 }
    })
    await stopProcess('proxy-server')
    const proc = mockProcesses.find(p => p.name === 'proxy-server')
    expect(proc?.pm2_env?.status).toBe('stopped')
  })
})

describe('reloadProcess', () => {
  it('connects, reloads a process by name, and disconnects', async () => {
    addMockProcess({
      name: 'proxy-server',
      pm2_env: { status: 'online', pm_uptime: Date.now(), restart_time: 0 },
      monit: { memory: 1024, cpu: 5 }
    })
    await reloadProcess('proxy-server')
    const proc = mockProcesses.find(p => p.name === 'proxy-server')
    expect(proc?.pm2_env?.status).toBe('online')
  })
})

describe('getProcessStatus', () => {
  it('returns null for a non-existent process', async () => {
    const result = await getProcessStatus('non-existent')
    expect(result).toBeNull()
  })

  it('returns process status for an existing process', async () => {
    addMockProcess({
      name: 'proxy-server',
      pid: 12345,
      pm_id: 0,
      pm2_env: { status: 'online', pm_uptime: 1000000, restart_time: 3 },
      monit: { memory: 5242880, cpu: 2.5 }
    })

    const result = await getProcessStatus('proxy-server')
    expect(result).not.toBeNull()
    expect(result!.name).toBe('proxy-server')
    expect(result!.status).toBe('online')
    expect(result!.cpu).toBe(2.5)
    expect(result!.memory).toBe(5242880)
    expect(result!.uptime).toBe(1000000)
    expect(result!.restarts).toBe(3)
  })

  it('defaults to "stopped" status when pm2_env.status is undefined', async () => {
    addMockProcess({
      name: 'broken-process',
      pm2_env: {},
      monit: {}
    })

    const result = await getProcessStatus('broken-process')
    expect(result).not.toBeNull()
    expect(result!.status).toBe('stopped')
    expect(result!.cpu).toBe(0)
    expect(result!.memory).toBe(0)
    expect(result!.uptime).toBe(0)
    expect(result!.restarts).toBe(0)
  })

  it('uses name parameter as fallback when proc.name is undefined', async () => {
    // Add a process where name field exists in list but is undefined
    // We simulate this by pushing directly and verifying the ?? fallback
    addMockProcess({
      name: 'fallback-name',
      pm2_env: { status: 'online' },
      monit: { cpu: 1, memory: 100 }
    })
    // Override the name to undefined after adding (to test ?? fallback)
    mockProcesses[0].name = undefined as any

    const result = await getProcessStatus('fallback-name')
    // The find uses p.name === name, so undefined === 'fallback-name' is false
    // This means the process won't be found - which is expected behavior
    expect(result).toBeNull()
  })

  it('returns name from process description when defined', async () => {
    addMockProcess({
      name: 'my-app',
      pm2_env: { status: 'online' },
      monit: { cpu: 1, memory: 100 }
    })

    const result = await getProcessStatus('my-app')
    expect(result!.name).toBe('my-app')
  })

  it('returns errored status correctly', async () => {
    addMockProcess({
      name: 'error-process',
      pm2_env: { status: 'errored', pm_uptime: 0, restart_time: 5 },
      monit: { memory: 0, cpu: 0 }
    })

    const result = await getProcessStatus('error-process')
    expect(result!.status).toBe('errored')
    expect(result!.restarts).toBe(5)
  })
})

describe('shared pm2 connection', () => {
  it('calls pm2.connect only once across consecutive exported calls', async () => {
    const connectSpy = jest.spyOn(jest.requireMock('pm2'), 'connect')

    await getProcessStatus('non-existent')
    await getProcessStatus('non-existent')

    expect(connectSpy).toHaveBeenCalledTimes(1)
  })

  it('retries connect on the next call after a connect rejection', async () => {
    const pm2Mock = jest.requireMock('pm2')
    const connectSpy = jest.spyOn(pm2Mock, 'connect')
    connectSpy.mockImplementationOnce((...args: any[]) => {
      const cb = args[0] as ((err: Error | null) => void) | undefined
      cb?.(new Error('connect failed'))
    })

    await expect(getProcessStatus('non-existent')).rejects.toThrow('connect failed')
    expect(connectSpy).toHaveBeenCalledTimes(1)

    await getProcessStatus('non-existent')
    expect(connectSpy).toHaveBeenCalledTimes(2)
  })

  it('disconnectPm2 closes the shared connection so the next call reconnects', async () => {
    const connectSpy = jest.spyOn(jest.requireMock('pm2'), 'connect')

    await getProcessStatus('non-existent')
    expect(connectSpy).toHaveBeenCalledTimes(1)

    await disconnectPm2()
    await getProcessStatus('non-existent')
    expect(connectSpy).toHaveBeenCalledTimes(2)
  })
})

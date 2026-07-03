import {
  resetMockState,
  addMockProcess,
  mockProcesses,
  createPm2Mock
} from '@utils/__mocks__/pm2-helpers'

jest.mock('pm2', () => {
  const { createPm2Mock } = jest.requireActual('@utils/__mocks__/pm2-helpers')
  return createPm2Mock()
})

const mockConfig = () => ({
  server: { port: 3000, host: 'localhost' },
  proxy: {
    target: 'https://token-plan.cn-beijing.mayuncs.com/apps/anthropic',
    changeOrigin: true
  },
  logging: { level: 'info', file: 'logs/proxy.log' }
})

jest.mock('@config/index', () => ({
  loadConfig: jest.fn().mockImplementation(() => Promise.resolve(mockConfig())),
  saveConfig: jest.fn().mockResolvedValue(undefined),
  resetConfig: jest.fn().mockResolvedValue(undefined)
}))

jest.mock('@logger/index', () => ({
  readLogs: jest.fn().mockResolvedValue([
    '{"level":30,"msg":"Server started"}',
    '{"level":40,"msg":"Slow request"}',
    '{"level":50,"msg":"Proxy error"}'
  ])
}))

jest.mock('open', () => jest.fn().mockResolvedValue(undefined))

// ora/chalk 是纯 ESM，ts-jest CJS 环境无法解析，mock 掉
jest.mock('ora', () => {
  const spinner = {
    start: jest.fn(function (this: any) { return this }),
    succeed: jest.fn(function (this: any) { return this }),
    fail: jest.fn(function (this: any) { return this }),
    text: ''
  }
  return { __esModule: true, default: jest.fn(() => spinner) }
})

jest.mock('chalk', () => {
  const identity = (s: string) => s
  const proxy: any = new Proxy(identity, {
    get: () => proxy,
    apply: (_t, _this, args) => args[0]
  })
  return { __esModule: true, default: proxy }
})

// 隔离真实端口探测，直接返回 true
jest.mock('@utils/net', () => ({
  waitForPort: jest.fn().mockResolvedValue(true)
}))

// waitForOnline 依赖 pm2 读取 ecosystem 解析进程名，mock pm2 无法还原，直接返回 true
jest.mock('@utils/pm2', () => {
  const actual = jest.requireActual('@utils/pm2')
  return { ...actual, waitForOnline: jest.fn().mockResolvedValue(true) }
})

jest.mock('child_process', () => ({
  execSync: jest.fn()
}))

jest.mock('fs', () => ({
  ...jest.requireActual('fs'),
  existsSync: jest.fn().mockReturnValue(true),
  promises: {
    ...jest.requireActual('fs').promises
  }
}))

// esm-dirname is mocked via moduleNameMapper in jest.config.cjs (uses import.meta.url)

import { startCommand } from '../commands/start'
import { stopCommand } from '../commands/stop'
import { statusCommand } from '../commands/status'
import { logsCommand } from '../commands/logs'
import { configCommand } from '../commands/config'
import { reloadCommand } from '../commands/reload'
import { testCommand } from '../commands/test'
import { uiCommand } from '../commands/ui'
import { loadConfig, saveConfig, resetConfig } from '@config/index'
import { readLogs } from '@logger/index'

jest.spyOn(console, 'log').mockImplementation(() => {})
jest.spyOn(console, 'error').mockImplementation(() => {})

beforeEach(() => {
  resetMockState()
  jest.clearAllMocks()
})

afterAll(() => {
  jest.restoreAllMocks()
})

describe('startCommand', () => {
  it('starts the proxy server and verifies the port', async () => {
    const { waitForPort } = require('@utils/net')
    await startCommand({})
    expect(mockProcesses.length).toBe(1)
    expect(waitForPort).toHaveBeenCalled()
  })

  it('updates port in config when port option provided', async () => {
    await startCommand({ port: 8080 })
    expect(loadConfig).toHaveBeenCalled()
    expect(saveConfig).toHaveBeenCalled()
    const savedConfig = (saveConfig as jest.Mock).mock.calls[0][0]
    expect(savedConfig.server.port).toBe(8080)
  })

  it('does not save config when no port option', async () => {
    await startCommand({})
    expect(saveConfig).not.toHaveBeenCalled()
  })
})

describe('stopCommand', () => {
  it('stops the proxy server and logs', async () => {
    addMockProcess({
      name: 'cc-monitoring',
      pm2_env: { status: 'online', pm_uptime: Date.now(), restart_time: 0 },
      monit: { memory: 1024, cpu: 5 }
    })
    await stopCommand()
    const proc = mockProcesses.find(p => p.name === 'cc-monitoring')
    expect(proc?.pm2_env?.status).toBe('stopped')
    expect(console.log).toHaveBeenCalledWith('Stopping proxy server...')
    expect(console.log).toHaveBeenCalledWith('Server stopped')
  })
})

describe('statusCommand', () => {
  it('reports server not running when process absent', async () => {
    await statusCommand()
    expect(console.log).toHaveBeenCalledWith('Server not running')
  })

  it('reports full status when process exists', async () => {
    addMockProcess({
      name: 'cc-monitoring',
      pm2_env: { status: 'online', pm_uptime: 60000, restart_time: 2 },
      monit: { memory: 5242880, cpu: 3.5 }
    })
    await statusCommand()
    expect(console.log).toHaveBeenCalledWith('Proxy Server Status:')
    expect(console.log).toHaveBeenCalledWith('  Status: online')
    expect(console.log).toHaveBeenCalledWith('  CPU: 3.5%')
    expect(console.log).toHaveBeenCalledWith('  Memory: 5.00 MB')
    expect(console.log).toHaveBeenCalledWith('  Uptime: 60s')
    expect(console.log).toHaveBeenCalledWith('  Restarts: 2')
  })
})

describe('logsCommand', () => {
  it('reads logs with default limit 50', async () => {
    await logsCommand(undefined, {})
    expect(loadConfig).toHaveBeenCalled()
    expect(readLogs).toHaveBeenCalledWith('logs/proxy.log', {
      limit: 50,
      level: undefined,
      grep: undefined
    })
    expect(console.log).toHaveBeenCalledTimes(3)
  })

  it('reads logs with custom limit', async () => {
    await logsCommand('10', {})
    expect(readLogs).toHaveBeenCalledWith('logs/proxy.log', {
      limit: 10,
      level: undefined,
      grep: undefined
    })
  })

  it('reads logs with level filter', async () => {
    await logsCommand(undefined, { level: 'error' })
    expect(readLogs).toHaveBeenCalledWith('logs/proxy.log', {
      limit: 50,
      level: 'error',
      grep: undefined
    })
  })

  it('reads logs with grep filter', async () => {
    await logsCommand(undefined, { grep: 'error' })
    expect(readLogs).toHaveBeenCalledWith('logs/proxy.log', {
      limit: 50,
      level: undefined,
      grep: 'error'
    })
  })
})

describe('configCommand', () => {
  it('shows config with action "show"', async () => {
    await configCommand('show')
    expect(loadConfig).toHaveBeenCalled()
    expect(console.log).toHaveBeenCalledWith(JSON.stringify({
      server: { port: 3000, host: 'localhost' },
      proxy: {
        target: 'https://token-plan.cn-beijing.mayuncs.com/apps/anthropic',
        changeOrigin: true
      },
      logging: { level: 'info', file: 'logs/proxy.log' }
    }, null, 2))
  })

  it('sets a config value with action "set"', async () => {
    await configCommand('set', 'server.port', '8080')
    expect(loadConfig).toHaveBeenCalled()
    expect(saveConfig).toHaveBeenCalled()
    expect(console.log).toHaveBeenCalledWith('Config updated')
  })

  it('sets a boolean config value', async () => {
    await configCommand('set', 'proxy.changeOrigin', 'false')
    const savedConfig = (saveConfig as jest.Mock).mock.calls[0][0]
    expect(savedConfig.proxy.changeOrigin).toBe(false)
  })

  it('sets a string config value', async () => {
    await configCommand('set', 'logging.level', 'debug')
    const savedConfig = (saveConfig as jest.Mock).mock.calls[0][0]
    expect(savedConfig.logging.level).toBe('debug')
  })

  it('reports invalid config key for nonexistent path', async () => {
    await configCommand('set', 'nonexistent.key', 'value')
    expect(console.error).toHaveBeenCalledWith('Invalid config key')
    expect(saveConfig).not.toHaveBeenCalled()
  })

  it('resets config with action "reset"', async () => {
    await configCommand('reset')
    expect(resetConfig).toHaveBeenCalled()
    expect(console.log).toHaveBeenCalledWith('Config reset to defaults')
  })

  it('reports error for invalid action', async () => {
    await configCommand('invalid')
    expect(console.error).toHaveBeenCalledWith('Invalid action. Use: show, set, reset')
  })
})

describe('reloadCommand', () => {
  it('reloads the proxy server and verifies the port', async () => {
    const { waitForPort } = require('@utils/net')
    addMockProcess({
      name: 'cc-monitoring',
      pm2_env: { status: 'online', pm_uptime: Date.now(), restart_time: 0 },
      monit: { memory: 1024, cpu: 5 }
    })
    await reloadCommand()
    expect(waitForPort).toHaveBeenCalled()
    const proc = mockProcesses.find(p => p.name === 'cc-monitoring')
    expect(proc?.pm2_env?.status).toBe('online')
  })
})

describe('testCommand', () => {
  let fetchSpy: jest.SpyInstance

  afterEach(() => {
    if (fetchSpy) fetchSpy.mockRestore()
  })

  it('tests connection to target and reports success', async () => {
    fetchSpy = jest.spyOn(globalThis, 'fetch').mockResolvedValue({ status: 200 } as Response)

    await testCommand()
    expect(loadConfig).toHaveBeenCalled()
    expect(console.log).toHaveBeenCalledWith('Testing connection to target...')
    expect(console.log).toHaveBeenCalledWith('Success! Target reachable. Status: 200')
  })

  it('reports failure when connection fails', async () => {
    fetchSpy = jest.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Network error'))

    await testCommand()
    expect(console.log).toHaveBeenCalledWith('Testing connection to target...')
    expect(console.error).toHaveBeenCalledWith('Connection failed:', 'Network error')
  })
})

describe('uiCommand', () => {
  it('reports error when server not running', async () => {
    await uiCommand({})
    expect(console.error).toHaveBeenCalledWith('Server not running. Use "proxy start" first.')
  })

  it('opens UI when server is running', async () => {
    addMockProcess({
      name: 'cc-monitoring',
      pm2_env: { status: 'online', pm_uptime: Date.now(), restart_time: 0 },
      monit: { memory: 1024, cpu: 5 }
    })
    await uiCommand({})
    expect(console.log).toHaveBeenCalledWith('Opening UI: http://localhost:3000/ui')
  })

  it('does not rebuild UI when dist exists and no --build flag', async () => {
    addMockProcess({
      name: 'cc-monitoring',
      pm2_env: { status: 'online', pm_uptime: Date.now(), restart_time: 0 },
      monit: { memory: 1024, cpu: 5 }
    })
    const { execSync } = require('child_process')
    await uiCommand({})
    expect(execSync).not.toHaveBeenCalled()
  })

  it('builds UI when --build flag is provided', async () => {
    addMockProcess({
      name: 'cc-monitoring',
      pm2_env: { status: 'online', pm_uptime: Date.now(), restart_time: 0 },
      monit: { memory: 1024, cpu: 5 }
    })
    const { execSync } = require('child_process')
    await uiCommand({ build: true })
    expect(console.log).toHaveBeenCalledWith('Building UI...')
    expect(execSync).toHaveBeenCalled()
  })
})

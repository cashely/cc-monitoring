/**
 * PM2 mock helpers - test state management for the pm2 mock.
 * This module does NOT import pm2 and is used alongside jest.mock('pm2').
 */

interface MockProcess {
  name: string
  pid?: number
  pm_id?: number
  monit?: { memory?: number; cpu?: number }
  pm2_env?: {
    status?: string
    pm_uptime?: number
    restart_time?: number
  }
}

const mockProcesses: MockProcess[] = []
let connected = false

function resetMockState(): void {
  mockProcesses.length = 0
  connected = false
}

function addMockProcess(proc: MockProcess): void {
  mockProcesses.push(proc)
}

function removeMockProcess(name: string): void {
  const idx = mockProcesses.findIndex(p => p.name === name)
  if (idx !== -1) mockProcesses.splice(idx, 1)
}

function setProcessStatus(name: string, status: string): void {
  const proc = mockProcesses.find(p => p.name === name)
  if (proc && proc.pm2_env) {
    proc.pm2_env.status = status
  }
}

/**
 * Creates the mock pm2 object that jest.mock('pm2') will use.
 * Must be called inside the jest.mock factory (hoisted code).
 */
function createPm2Mock(): Record<string, any> {
  return {
    connect(cb?: (err: Error | null) => void): void {
      connected = true
      cb?.(null)
    },

    disconnect(): void {
      connected = false
    },

    start(options: any, cb?: (err: Error | null, proc: any) => void): void {
      if (!connected) {
        cb?.(new Error('PM2 not connected'), undefined)
        return
      }
      const name = typeof options === 'string'
        ? options
        : options?.name ?? 'mock-process'
      addMockProcess({
        name,
        pm2_env: { status: 'online', pm_uptime: Date.now(), restart_time: 0 },
        monit: { memory: 0, cpu: 0 }
      })
      cb?.(null, {})
    },

    stop(name: string | number, cb?: (err: Error | null, proc: any) => void): void {
      if (!connected) {
        cb?.(new Error('PM2 not connected'), undefined)
        return
      }
      const procName = String(name)
      const proc = mockProcesses.find(p => p.name === procName)
      if (proc && proc.pm2_env) {
        proc.pm2_env.status = 'stopped'
      }
      cb?.(null, {})
    },

    reload(name: string | number, cb?: (err: Error | null, proc: any) => void): void {
      if (!connected) {
        cb?.(new Error('PM2 not connected'), undefined)
        return
      }
      const procName = String(name)
      const proc = mockProcesses.find(p => p.name === procName)
      if (proc && proc.pm2_env) {
        proc.pm2_env.status = 'online'
      }
      cb?.(null, {})
    },

    list(cb?: (err: Error | null, list: any[]) => void): void {
      if (!connected) {
        cb?.(new Error('PM2 not connected'), [])
        return
      }
      cb?.(null, mockProcesses)
    }
  }
}

export {
  resetMockState,
  addMockProcess,
  removeMockProcess,
  setProcessStatus,
  createPm2Mock,
  mockProcesses,
  connected
}

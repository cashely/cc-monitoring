import { getProcessStatus } from '../../utils/pm2.js'

export async function statusCommand(): Promise<void> {
  const status = await getProcessStatus('cc-monitoring')

  if (!status) {
    console.log('Server not running')
    return
  }

  console.log('Proxy Server Status:')
  console.log(`  Status: ${status.status}`)
  console.log(`  CPU: ${status.cpu}%`)
  console.log(`  Memory: ${(status.memory / 1024 / 1024).toFixed(2)} MB`)
  console.log(`  Uptime: ${(status.uptime / 1000).toFixed(0)}s`)
  console.log(`  Restarts: ${status.restarts}`)
}

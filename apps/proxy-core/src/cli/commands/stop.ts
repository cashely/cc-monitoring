import { stopProcess } from '../../utils/pm2.js'

export async function stopCommand(): Promise<void> {
  console.log('Stopping proxy server...')
  await stopProcess('cc-monitoring')
  console.log('Server stopped')
}

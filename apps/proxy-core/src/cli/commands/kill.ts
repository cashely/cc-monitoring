import { killProcess } from '../../utils/pm2.js'

export async function killCommand(): Promise<void> {
  console.log('Killing proxy server...')
  await killProcess('cc-monitoring')
  console.log('Server killed and removed from PM2')
}

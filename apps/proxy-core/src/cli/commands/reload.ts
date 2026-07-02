import { reloadProcess } from '../../utils/pm2.js'

export async function reloadCommand(): Promise<void> {
  console.log('Reloading server...')
  await reloadProcess('cc-monitoring')
  console.log('Server reloaded')
}

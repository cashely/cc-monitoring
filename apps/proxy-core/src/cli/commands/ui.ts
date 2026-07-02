import { execSync } from 'child_process'
import fs from 'fs'
import path from 'path'
import { loadConfig } from '../../config/index.js'
import { getProcessStatus } from '../../utils/pm2.js'
import { getCallerDirname } from '../../utils/esm-dirname.js'

// Derive cli/commands directory from utils dirname (esm-dirname lives in src/utils/)
const commandsDirname = getCallerDirname('../cli/commands')

export interface UiOptions {
  build?: boolean
}

export async function uiCommand(options: UiOptions): Promise<void> {
  const status = await getProcessStatus('cc-monitoring')
  if (!status || status.status !== 'online') {
    console.error('Server not running. Use "proxy start" first.')
    return
  }

  const uiDistPath = path.join(commandsDirname, '../../../ui/dist')
  const needsBuild = options.build || !fs.existsSync(uiDistPath)

  if (needsBuild) {
    console.log('Building UI...')
    execSync('pnpm --filter @proxy/ui build', { stdio: 'inherit', cwd: path.join(commandsDirname, '../../..') })
  }

  const config = await loadConfig()
  const url = `http://${config.server.host}:${config.server.port}/ui`

  console.log(`Opening UI: ${url}`)
  // Dynamic import for 'open' since it's ESM-only
  const open = (await import('open')).default
  await open(url)
}

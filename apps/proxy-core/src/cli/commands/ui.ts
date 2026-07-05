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
    console.error('Server not running. Use "ccm start" first.')
    return
  }

  // 发布产物：与 server 同级的 dist/ui；本地开发：monorepo 的 proxy-cli/dist
  const bundledUi = path.join(commandsDirname, '../../ui')
  const monorepoUi = path.join(commandsDirname, '../../../../proxy-cli/dist')
  const uiExists = fs.existsSync(bundledUi) || fs.existsSync(monorepoUi)
  const needsBuild = options.build || !uiExists

  if (needsBuild) {
    // 仅 monorepo 场景下才可能触发 build；全局安装场景 bundledUi 一定存在
    console.log('Building UI...')
    execSync('pnpm --filter @cc-monitoring/proxy-cli build', {
      stdio: 'inherit',
      cwd: path.join(commandsDirname, '../../../..')
    })
  }

  const config = await loadConfig()
  const url = `http://${config.server.host}:${config.server.port}/ui`

  console.log(`Opening UI: ${url}`)
  // Dynamic import for 'open' since it's ESM-only
  const open = (await import('open')).default
  await open(url)
}

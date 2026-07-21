import { execSync } from 'child_process'
import fs from 'fs'
import path from 'path'
import { loadConfig } from '../../config/index.js'
import { getProcessStatus } from '../../utils/pm2.js'
import { getCallerDirname } from '../../utils/esm-dirname.js'

const commandsDirname = getCallerDirname('../cli/commands')

export interface DocOptions {
  build?: boolean
}

export async function docCommand(options: DocOptions): Promise<void> {
  const status = await getProcessStatus('cc-monitoring')
  if (!status || status.status !== 'online') {
    console.error('Server not running. Use "ccm start" first.')
    return
  }

  // 发布产物：dist/docs；本地开发：monorepo 的 proxy-docs/dist
  const bundledDocs = path.join(commandsDirname, '../../docs')
  const monorepoDocs = path.join(commandsDirname, '../../../../proxy-docs/dist')
  const docsExists = fs.existsSync(bundledDocs) || fs.existsSync(monorepoDocs)
  const needsBuild = options.build || !docsExists

  if (needsBuild) {
    console.log('Building docs...')
    execSync('pnpm --filter @cc-monitoring/docs build', {
      stdio: 'inherit',
      cwd: path.join(commandsDirname, '../../../..')
    })
  }

  const config = await loadConfig()
  const url = `http://${config.server.host}:${config.server.port}/docs/`

  console.log(`Opening docs: ${url}`)
  const open = (await import('open')).default
  await open(url)
}

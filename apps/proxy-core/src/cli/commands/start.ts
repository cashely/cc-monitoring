import { startProcess } from '../../utils/pm2.js'
import { loadConfig, saveConfig } from '../../config/index.js'
import path from 'path'
import { fileURLToPath } from 'url'
import { getCallerDirname } from '../../utils/esm-dirname.js'

export interface StartOptions {
  port?: number
}

export async function startCommand(options: StartOptions): Promise<void> {
  try {
    if (options.port) {
      const config = await loadConfig()
      config.server.port = options.port
      await saveConfig(config)
    }

    // Find ecosystem.config.cjs relative to this file's location (packages/core/)
    const cliDirname = getCallerDirname('../cli')
    const ecosystemPath = path.join(cliDirname, '..', '..', 'ecosystem.config.cjs')

    console.log('Starting proxy server...')
    await startProcess(ecosystemPath)
    console.log('Server started successfully')
  } catch (error) {
    console.error('Failed to start server:', error instanceof Error ? error.message : String(error))
    process.exit(1)
  }
}

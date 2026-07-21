#!/usr/bin/env node
import { Command } from 'commander'
import path from 'path'
import { setConfigPathOverride } from '../utils/paths.js'
import { getProjectVersion } from '../utils/version.js'

// Check for -p/--prompt BEFORE loading commander and other commands
function checkForPromptOption() {
  let prompt: string | null = null
  let configPath: string | null = null

  for (let i = 0; i < process.argv.length; i++) {
    const arg = process.argv[i]
    if (arg === '-p' || arg === '--prompt') {
      if (i + 1 < process.argv.length) {
        prompt = process.argv[i + 1]
      }
    }
    if (arg === '-c' || arg === '--config') {
      if (i + 1 < process.argv.length) {
        configPath = process.argv[i + 1]
      }
    }
  }

  return { prompt, configPath }
}

// Handle prompt option early
const { prompt, configPath } = checkForPromptOption()
if (prompt) {
  if (configPath) {
    setConfigPathOverride(path.resolve(configPath))
  }
  const { execCommand } = await import('./commands/exec.js')
  await execCommand(prompt)
  process.exit(0)
}

const program = new Command()

program
  .name('ccm')
  .description('Claude Code Proxy Helper')
  .version(getProjectVersion())
  .option('-c, --config <path>', 'Path to config file')
  .option('-p, --prompt <prompt>', 'Execute claude -p <prompt> via server')
  .hook('preAction', () => {
    const opts = program.opts()
    if (opts.config) {
      setConfigPathOverride(path.resolve(opts.config))
    }
  })

program.command('prompt')
  .alias('p')
  .description('Execute claude -p <prompt> via server')
  .argument('<prompt>', 'Prompt text')
  .action(async (prompt) => {
    const { execCommand } = await import('./commands/exec.js')
    await execCommand(prompt)
  })

program.command('start')
  .description('Start proxy server')
  .option('-p, --port <port>', 'Override port', (val) => parseInt(val))
  .action(async (options) => {
    const { startCommand } = await import('./commands/start.js')
    await startCommand(options)
  })

program.command('stop')
  .description('Stop proxy server')
  .action(async () => {
    const { stopCommand } = await import('./commands/stop.js')
    await stopCommand()
  })

program.command('kill')
  .description('Kill proxy server and remove from PM2')
  .action(async () => {
    const { killCommand } = await import('./commands/kill.js')
    await killCommand()
  })

program.command('status')
  .description('Show server status')
  .action(async () => {
    const { statusCommand } = await import('./commands/status.js')
    await statusCommand()
  })

program.command('logs [n]')
  .description('Show recent logs')
  .option('-l, --level <level>', 'Filter by level')
  .option('-g, --grep <pattern>', 'Search pattern')
  .action(async (n, options) => {
    const { logsCommand } = await import('./commands/logs.js')
    await logsCommand(n, options)
  })

program.command('config <action> [key] [value]')
  .description('Manage configuration (show/set/reset)')
  .action(async (action, key, value) => {
    const { configCommand } = await import('./commands/config.js')
    await configCommand(action, key, value)
  })

program.command('reload')
  .description('Restart server (graceful)')
  .action(async () => {
    const { reloadCommand } = await import('./commands/reload.js')
    await reloadCommand()
  })

program.command('test')
  .description('Test connection to target')
  .action(async () => {
    const { testCommand } = await import('./commands/test.js')
    await testCommand()
  })

program.command('ui')
  .description('Open web UI dashboard')
  .option('--build', 'Force rebuild UI')
  .action(async (options) => {
    const { uiCommand } = await import('./commands/ui.js')
    await uiCommand(options)
  })

program.command('doc')
  .description('Open architecture docs')
  .option('--build', 'Force rebuild docs')
  .action(async (options) => {
    const { docCommand } = await import('./commands/doc.js')
    await docCommand(options)
  })

program.command('clean-requests')
  .description('清理旧的请求日志（SQLite）')
  .option('--days <days>', '保留最近N天的数据', '7')
  .action(async (options) => {
    const { loadConfig } = await import('../config/index.js')
    const { configureDbPath } = await import('../utils/db.js')
    const { cleanOldRequestsDB } = await import('../utils/request-writer.js')
    const config = await loadConfig()
    if (config.storage?.path) {
      configureDbPath(config.storage.path)
    }
    const days = parseInt(options.days)
    console.log(`正在清理，保留最近 ${days} 天的数据...`)
    await cleanOldRequestsDB(days)
    console.log('清理完成')
  })

program.parse()

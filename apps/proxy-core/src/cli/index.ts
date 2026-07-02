import { Command } from 'commander'
import { startCommand } from './commands/start.js'
import { stopCommand } from './commands/stop.js'
import { statusCommand } from './commands/status.js'
import { logsCommand } from './commands/logs.js'
import { configCommand } from './commands/config.js'
import { reloadCommand } from './commands/reload.js'
import { testCommand } from './commands/test.js'
import { uiCommand } from './commands/ui.js'

const program = new Command()

program
  .name('proxy')
  .description('Claude Code Proxy Helper - Forward requests to Aliyun')
  .version('1.0.0')

program.command('start')
  .description('Start proxy server')
  .option('-p, --port <port>', 'Override port', (val) => parseInt(val))
  .action(startCommand)

program.command('stop')
  .description('Stop proxy server')
  .action(stopCommand)

program.command('status')
  .description('Show server status')
  .action(statusCommand)

program.command('logs [n]')
  .description('Show recent logs')
  .option('-l, --level <level>', 'Filter by level')
  .option('-g, --grep <pattern>', 'Search pattern')
  .action(logsCommand)

program.command('config <action> [key] [value]')
  .description('Manage configuration (show/set/reset)')
  .action(configCommand)

program.command('reload')
  .description('Restart server (graceful)')
  .action(reloadCommand)

program.command('test')
  .description('Test connection to target')
  .action(testCommand)

program.command('ui')
  .description('Open web UI dashboard')
  .option('--build', 'Force rebuild UI')
  .action(uiCommand)

program.command('clean-requests')
  .description('清理旧的请求日志（SQLite）')
  .option('--days <days>', '保留最近N天的数据', '7')
  .action(async (options) => {
    const { cleanOldRequestsDB } = await import('../utils/request-writer.js')
    const days = parseInt(options.days)
    console.log(`正在清理，保留最近 ${days} 天的数据...`)
    await cleanOldRequestsDB(days)
    console.log('清理完成')
  })

program.parse()

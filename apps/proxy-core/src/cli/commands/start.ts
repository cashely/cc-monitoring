import path from 'path'
import ora from 'ora'
import chalk from 'chalk'
import { startProcess, waitForOnline } from '../../utils/pm2.js'
import { loadConfig, saveConfig } from '../../config/index.js'
import { getCallerDirname } from '../../utils/esm-dirname.js'
import { waitForPort } from '../../utils/net.js'
import { logsDir } from '../../utils/paths.js'

export interface StartOptions {
  port?: number
}

const PROCESS_NAME = 'cc-monitoring'

export async function startCommand(options: StartOptions): Promise<void> {
  const spinner = ora()
  try {
    // 1. 加载配置（可选覆盖端口）
    spinner.start('Loading config')
    const config = await loadConfig()
    if (options.port) {
      config.server.port = options.port
      await saveConfig(config)
    }
    const { host, port } = config.server
    spinner.succeed(`Config loaded ${chalk.gray(`· port ${port}`)}`)

    // 2. 定位 PM2 配置文件
    spinner.start('Locating PM2 config')
    const cliDirname = getCallerDirname('../cli')
    const ecosystemPath = path.join(cliDirname, '..', '..', 'ecosystem.config.cjs')
    spinner.succeed('PM2 config located')

    // 3 + 4. 连接 PM2 守护进程并启动进程
    spinner.start(`Starting process ${PROCESS_NAME}`)
    await startProcess(ecosystemPath)
    spinner.succeed(`Process ${PROCESS_NAME} started`)

    // 5. 等待进程 online
    spinner.start('Waiting for process (online)')
    const online = await waitForOnline(PROCESS_NAME)
    if (!online) {
      spinner.fail('Process did not reach online state')
      console.error(chalk.red(`Check logs: ${path.join(logsDir, 'error.log')}`))
      process.exit(1)
    }
    spinner.succeed('Process is online')

    // 6. 探测端口，确认真正在监听
    spinner.start(`Verifying port ${host}:${port}`)
    const listening = await waitForPort(host, port, (attempt, max) => {
      spinner.text = `Verifying port ${host}:${port} ${chalk.gray(`(attempt ${attempt}/${max})`)}`
    })
    if (!listening) {
      spinner.fail(`Port ${host}:${port} is not listening`)
      console.error(chalk.red(`Check logs: ${path.join(logsDir, 'error.log')}`))
      process.exit(1)
    }
    spinner.succeed(`Port ${host}:${port} is listening`)

    printSummary(config)
  } catch (error) {
    spinner.fail('Failed to start server')
    console.error(chalk.red(error instanceof Error ? error.message : String(error)))
    process.exit(1)
  }
}

function printSummary(config: Awaited<ReturnType<typeof loadConfig>>): void {
  const { host, port } = config.server
  const base = `http://${host}:${port}`
  console.log()
  console.log(chalk.green.bold('  ✔ Proxy server is running'))
  console.log(`    ${chalk.gray('Listening')}     ${chalk.cyan(base)}`)
  console.log(`    ${chalk.gray('Forwarding to')} ${chalk.cyan(config.proxy.target)}`)
  console.log(`    ${chalk.gray('Dashboard')}     ${chalk.cyan(`${base}/ui`)}`)
  console.log(`    ${chalk.gray('Logs')}          ${path.join(logsDir, 'out.log')}`)
  console.log()
}

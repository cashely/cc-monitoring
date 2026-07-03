import path from 'path'
import ora from 'ora'
import chalk from 'chalk'
import { reloadProcess, waitForOnline } from '../../utils/pm2.js'
import { loadConfig } from '../../config/index.js'
import { waitForPort } from '../../utils/net.js'
import { logsDir } from '../../utils/paths.js'

const PROCESS_NAME = 'cc-monitoring'

export async function reloadCommand(): Promise<void> {
  const spinner = ora()
  try {
    // 1. 加载配置（读取监听地址用于探测与汇总）
    spinner.start('Loading config')
    const config = await loadConfig()
    const { host, port } = config.server
    spinner.succeed(`Config loaded ${chalk.gray(`· port ${port}`)}`)

    // 2. 优雅重启进程
    spinner.start(`Reloading process ${PROCESS_NAME}`)
    await reloadProcess(PROCESS_NAME)
    spinner.succeed(`Process ${PROCESS_NAME} reloaded`)

    // 3. 等待进程 online
    spinner.start('Waiting for process (online)')
    const online = await waitForOnline(PROCESS_NAME)
    if (!online) {
      spinner.fail('Process did not reach online state')
      console.error(chalk.red(`Check logs: ${path.join(logsDir, 'error.log')}`))
      process.exit(1)
    }
    spinner.succeed('Process is online')

    // 4. 探测端口，确认真正在监听
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

    const base = `http://${host}:${port}`
    console.log()
    console.log(chalk.green.bold('  ✔ Proxy server reloaded'))
    console.log(`    ${chalk.gray('Listening')} ${chalk.cyan(base)}`)
    console.log(`    ${chalk.gray('Dashboard')} ${chalk.cyan(`${base}/ui`)}`)
    console.log()
  } catch (error) {
    spinner.fail('Failed to reload server')
    console.error(chalk.red(error instanceof Error ? error.message : String(error)))
    process.exit(1)
  }
}

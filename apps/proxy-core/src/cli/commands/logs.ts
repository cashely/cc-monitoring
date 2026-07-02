import { loadConfig } from '../../config/index.js'
import { readLogs } from '../../logger/index.js'

export interface LogsOptions {
  level?: string
  grep?: string
}

export async function logsCommand(n: string | undefined, options: LogsOptions): Promise<void> {
  const config = await loadConfig()
  const logs = await readLogs(config.logging.file, {
    limit: n ? parseInt(n) : 50,
    level: options.level,
    grep: options.grep
  })

  logs.forEach(line => console.log(line))
}

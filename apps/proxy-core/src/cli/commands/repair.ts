import { loadConfig } from '../../config/index.js'
import { configureDbPath } from '../../utils/db.js'
import { repairClosedRequests } from '../../utils/request-writer.js'

export async function repairCommand(): Promise<void> {
  const config = await loadConfig()
  if (config.storage?.path) {
    configureDbPath(config.storage.path)
  }

  const { recovered, tokensFilled } = repairClosedRequests()

  if (recovered === 0 && tokensFilled === 0) {
    console.log('No interrupted requests needed repair.')
    return
  }

  console.log(`Recovered ${recovered} request(s) as completed, filled tokens for ${tokensFilled} request(s)`)
}

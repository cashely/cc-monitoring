import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { loadConfig } from '../config/index.js'
import { configureDbPath, initDatabase } from '../utils/db.js'
import { startDbWorker } from '../utils/db-worker-client.js'
import { createMcpServer } from './index.js'

export async function runMcpServer(): Promise<void> {
  const config = await loadConfig()

  if (config.storage?.path) {
    configureDbPath(config.storage.path)
  }
  const db = initDatabase()
  // migration 完成后启动 worker（list_requests 等工具走 worker 读写）
  startDbWorker(db.name)

  const server = createMcpServer(config)
  const transport = new StdioServerTransport()
  await server.connect(transport)
}

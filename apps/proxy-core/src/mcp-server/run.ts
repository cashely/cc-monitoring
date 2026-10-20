import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { loadConfig } from '../config/index.js'
import { configureDbPath, initDatabase } from '../utils/db.js'
import { createMcpServer } from './index.js'

export async function runMcpServer(): Promise<void> {
  const config = await loadConfig()

  if (config.storage?.path) {
    configureDbPath(config.storage.path)
  }
  initDatabase()

  const server = createMcpServer(config)
  const transport = new StdioServerTransport()
  await server.connect(transport)
}

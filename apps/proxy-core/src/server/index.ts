import Fastify from 'fastify'
import type { FastifyInstance, FastifyBaseLogger } from 'fastify'
import { loadConfig } from '../config/index.js'
import { createLogger } from '../logger/index.js'
import { configureDbPath } from '../utils/db.js'
import { getCurrentModuleUrl } from '../utils/esm-dirname.js'
import { setupProxy } from './proxy.js'
import { setupUiRoutes } from './ui-route.js'
import { setupChatRoute } from './chat-route.js'
import { setupDocsRoutes } from './docs-route.js'
import { requestIdMiddleware } from './middleware/request-id.js'

export async function createServer(): Promise<FastifyInstance> {
  const config = await loadConfig()
  if (config.storage?.path) {
    configureDbPath(config.storage.path)
  }
  const logger = createLogger(config.logging)

  const fastify = Fastify({
    logger: logger as unknown as FastifyBaseLogger,
    trustProxy: true
  })

  fastify.register(requestIdMiddleware)
  await setupUiRoutes(fastify)  // UI routes registered BEFORE proxy to avoid being proxied
  await setupProxy(fastify, config.proxy)
  await setupChatRoute(fastify, config.proxy)  // MCP-enhanced chat endpoint
  await setupDocsRoutes(fastify)

  return fastify
}

export async function startServer(): Promise<void> {
  const config = await loadConfig()
  const server = await createServer()

  await server.listen({
    port: config.server.port,
    host: config.server.host
  })

  server.log.info(`Server running at http://${config.server.host}:${config.server.port}`)
}

// Auto-start when executed directly (ESM entry point guard)
// PM2 compatibility: PM2 fork mode sets process.argv[1] to ProcessContainerFork.js wrapper,
// not the user script. Check PM2-specific env vars instead.
const _isPm2 = process.env.pm_id !== undefined || process.env.NODE_APP_INSTANCE !== undefined
const _currentModuleUrl = getCurrentModuleUrl()

// For PM2: always start if PM2 env detected and this module is the configured script
// For direct execution: check if this module is the main module
import path from 'path'
const _mainModulePath = process.argv[1] ? path.resolve(process.argv[1]) : ''
const _mainModuleUrl = _mainModulePath ? `file://${_mainModulePath}` : ''
const _isDirectExecution = _currentModuleUrl === _mainModuleUrl

if (_isPm2 || _isDirectExecution) {
  startServer().catch(err => {
    console.error('Server start failed:', err)
    process.exit(1)
  })
}

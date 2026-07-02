import { FastifyInstance } from 'fastify'
import { getDatabase } from '../utils/db.js'
import { listProviders, saveProviders, validateProviders } from '../utils/providers-db.js'
import type { ProviderInput, ProviderValidationError } from '../utils/providers-db.js'
import { checkAuth } from './auth.js'

export async function setupProvidersRoutes(fastify: FastifyInstance, config: any): Promise<void> {
  fastify.get('/ui/api/providers', async (request, reply) => {
    try {
      const db = getDatabase()
      const providers = listProviders(db)
      return { providers }
    } catch (err: any) {
      request.log.error({ err }, 'Failed to list providers')
      return reply.code(500).send({
        success: false,
        error: err.message || 'Failed to list providers'
      })
    }
  })

  fastify.post<{ Body: { providers: ProviderInput[] } }>('/ui/api/providers', async (request, reply) => {
    if (!checkAuth(request, config)) {
      return reply.code(401).send({
        success: false,
        error: 'Unauthorized: missing or invalid Authorization header'
      })
    }

    const providers = request.body?.providers
    if (!providers || !Array.isArray(providers)) {
      return reply.code(400).send({
        success: false,
        error: 'Request body must contain a "providers" array'
      })
    }

    const errors: ProviderValidationError[] = validateProviders(providers)
    if (errors.length > 0) {
      return reply.code(400).send({
        success: false,
        errors
      })
    }

    try {
      const db = getDatabase()
      saveProviders(db, providers)
      return { success: true }
    } catch (err: any) {
      request.log.error({ err }, 'Failed to save providers')
      return reply.code(500).send({
        success: false,
        error: err.message || 'Failed to save providers'
      })
    }
  })
}

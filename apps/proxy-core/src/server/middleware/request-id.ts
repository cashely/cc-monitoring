import { FastifyInstance } from 'fastify'
import { nanoid } from 'nanoid'

export const requestIdMiddleware = async (fastify: FastifyInstance): Promise<void> => {
  fastify.addHook('onRequest', async (request) => {
    const headerId = request.headers['x-request-id'] as string | undefined
    if (headerId) {
      request.id = headerId
    } else {
      request.id = nanoid(12)
    }
  })
}

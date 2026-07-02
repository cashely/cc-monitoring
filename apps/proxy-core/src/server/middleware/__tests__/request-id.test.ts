import Fastify, { FastifyInstance, FastifyRequest } from 'fastify'
import { requestIdMiddleware } from '../request-id'

describe('requestIdMiddleware', () => {
  let fastify: FastifyInstance

  beforeEach(async () => {
    fastify = Fastify()
    await requestIdMiddleware(fastify)
    fastify.get('/test', async (request: FastifyRequest) => ({ id: request.id }))
  })

  afterEach(async () => {
    await fastify.close()
  })

  it('generates nanoid when x-request-id header is absent', async () => {
    const response = await fastify.inject({ method: 'GET', url: '/test' })
    const body = JSON.parse(response.body)
    expect(body.id).toBeDefined()
    expect(body.id.length).toBe(12)
  })

  it('keeps existing id when x-request-id header is present', async () => {
    const response = await fastify.inject({
      method: 'GET',
      url: '/test',
      headers: { 'x-request-id': 'custom-id-123' }
    })
    const body = JSON.parse(response.body)
    expect(body.id).toBe('custom-id-123')
  })
})

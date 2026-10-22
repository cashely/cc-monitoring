// apps/proxy-core/src/server/docs-route.ts
import { FastifyInstance } from 'fastify'
import multipart from '@fastify/multipart'
import path from 'path'
import { registry } from '../parsers/index.js'

export async function setupDocsRoutes(fastify: FastifyInstance): Promise<void> {
  await fastify.register(multipart, { limits: { fileSize: 10 * 1024 * 1024 } })

  fastify.post('/ui/api/docs/upload', async (request, reply) => {
    const data = await request.file()
    if (!data) {
      return reply.code(400).send({ success: false, error: 'No file uploaded' })
    }

    const filename = path.basename(data.filename)
    const buffer = await data.toBuffer()

    // 校验扩展名
    const supported = registry.getSupportedExtensions()
    const dotIndex = filename.lastIndexOf('.')
    if (dotIndex === -1) {
      return reply.code(400).send({
        success: false,
        error: `File has no extension. Supported types: ${supported.join(', ')}`
      })
    }
    const ext = filename.slice(dotIndex).toLowerCase()
    if (!supported.includes(ext)) {
      return reply.code(400).send({
        success: false,
        error: `Unsupported file type: "${ext}". Supported types: ${supported.join(', ')}`
      })
    }

    // 解析文件内容为 md
    let mdContent: string
    try {
      mdContent = await registry.parse(buffer, filename)
    } catch (err: any) {
      request.log.error({ err, filename }, 'File parsing failed')
      return reply.code(500).send({
        success: false,
        error: err.message || 'File parsing failed'
      })
    }

    // 只负责解析并返回 md 文本，切块入库由前端/调用方后续处理
    return { success: true, markdown: mdContent }
  })
}

// apps/proxy-core/src/server/docs-route.ts
import { FastifyInstance } from 'fastify'
import multipart from '@fastify/multipart'
import path from 'path'
import { registry } from '../parsers/index.js'
import { loadConfig } from '../config/index.js'
import { createPiSession } from '../utils/pi-runtime.js'

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

    // 不直接落盘根目录，而是交给 pi learn agent 切块入库
    let config
    try {
      config = await loadConfig()
    } catch (err: any) {
      request.log.error({ err }, 'Failed to load config')
      return reply.code(500).send({
        success: false,
        error: err?.message || 'Failed to load config'
      })
    }
    const port = config.server.port

    const prompt = `以下是上传文档《${filename}》的完整内容。请按知识库规范处理：
1. 调 list_topics 查重，决定新建主题还是复用现有
2. 把文档内容按结构切成 300-500 字 chunks，写入 <主题>/chunks/chunk-NNN.md
3. 每写完一个 chunk 文件，立即调 add_chunk(topic, chunk_id, title, summary) 登记该 chunk
4. 若新建主题，先调 add_topic(slug, title, summary, tags) 注册主题；若复用现有主题，跳过此步

注意：不要手写 index.json 或 INDEX.md，主题元数据与 chunk 清单全部通过 add_topic / add_chunk 工具维护。

文档内容：
${mdContent}`

    let session
    try {
      session = await createPiSession({ port, mode: 'learn' })
    } catch (err: any) {
      request.log.error({ err }, 'Failed to create pi learn session')
      return reply.code(500).send({
        success: false,
        error: err?.message || 'Failed to initialize pi runtime'
      })
    }

    try {
      await Promise.race([
        session.prompt(prompt),
        new Promise((_, rej) => setTimeout(() => rej(new Error('Execution timeout (5 minutes)')), 5 * 60 * 1000)),
      ])
      await session.waitForIdle()
    } catch (err: any) {
      await session.abort().catch(() => {})
      request.log.error({ err, filename }, 'pi learn distill failed')
      return reply.code(500).send({
        success: false,
        error: err?.message || 'Failed to distill document into knowledge base'
      })
    }

    return { success: true, path: `docs/` }
  })
}

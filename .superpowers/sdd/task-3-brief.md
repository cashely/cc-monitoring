### Task 3: Upload API Route

**Files:**
- Create: `apps/proxy-core/src/server/docs-route.ts`
- Modify: `apps/proxy-core/src/server/index.ts`

**Interfaces:**
- Consumes: `registry` from `parsers/index.js`, `dataDir` from `utils/paths.js`
- Produces: `setupDocsRoutes(fastify)` — POST `/ui/api/docs/upload`

- [ ] **Step 1: 安装 @fastify/multipart**

```bash
cd apps/proxy-core && pnpm add @fastify/multipart
```

- [ ] **Step 2: 创建 docs-route.ts**

```typescript
// apps/proxy-core/src/server/docs-route.ts
import { FastifyInstance } from 'fastify'
import multipart from '@fastify/multipart'
import fs from 'fs'
import path from 'path'
import { registry } from '../parsers/index.js'
import { dataDir } from '../utils/paths.js'

const docsDir = path.join(dataDir, 'docs')

export async function setupDocsRoutes(fastify: FastifyInstance): Promise<void> {
  await fastify.register(multipart, { limits: { fileSize: 10 * 1024 * 1024 } })

  fastify.post('/ui/api/docs/upload', async (request, reply) => {
    const data = await request.file()
    if (!data) {
      return reply.code(400).send({ success: false, error: 'No file uploaded' })
    }

    const filename = data.filename
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

    // 确保 docs 目录存在
    if (!fs.existsSync(docsDir)) {
      fs.mkdirSync(docsDir, { recursive: true })
    }

    // 写入 md 文件
    const mdFilename = filename.slice(0, dotIndex) + '.md'
    const mdPath = path.join(docsDir, mdFilename)

    try {
      fs.writeFileSync(mdPath, mdContent, 'utf-8')
    } catch (err: any) {
      request.log.error({ err, mdPath }, 'Failed to write md file')
      return reply.code(500).send({
        success: false,
        error: 'Failed to save file'
      })
    }

    return { success: true, path: `docs/${mdFilename}` }
  })
}
```

- [ ] **Step 3: 修改 server/index.ts — 增加 setupDocsRoutes 注册**

在 `apps/proxy-core/src/server/index.ts` 中：

在 import 区域增加：
```typescript
import { setupDocsRoutes } from './docs-route.js'
```

在 `createServer()` 函数体中，在 `await setupChatRoute(fastify, config.proxy)` 之后增加：
```typescript
await setupDocsRoutes(fastify)
```

完整修改后的 createServer 函数体：
```typescript
fastify.register(requestIdMiddleware)
await setupUiRoutes(fastify)
await setupProxy(fastify, config.proxy)
await setupChatRoute(fastify, config.proxy)
await setupDocsRoutes(fastify)
```

- [ ] **Step 4: Commit**

```bash
git add apps/proxy-core/src/server/docs-route.ts apps/proxy-core/src/server/index.ts apps/proxy-core/package.json apps/proxy-core/pnpm-lock.yaml
git commit -m "feat: add docs upload API route"
```

---


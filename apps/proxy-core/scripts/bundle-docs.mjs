#!/usr/bin/env node
// 发布前打包文档：
// 1. 构建 proxy-docs 静态资源（VitePress）
// 2. 拷贝到 proxy-core/dist/docs（发布产物内自包含）
import { execSync } from 'node:child_process'
import { cp, rm, stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const coreRoot = path.resolve(__dirname, '..')
const monorepoRoot = path.resolve(coreRoot, '../..')
const docsRoot = path.resolve(coreRoot, '../proxy-docs')
const docsDist = path.join(docsRoot, 'dist')
const bundledDocs = path.join(coreRoot, 'dist/docs')

// 1. build proxy-docs
console.log('[bundle-docs] building @cc-monitoring/docs ...')
execSync('pnpm --filter @cc-monitoring/docs build', {
  cwd: monorepoRoot,
  stdio: 'inherit'
})

try {
  await stat(docsDist)
} catch {
  throw new Error(`proxy-docs dist not found at ${docsDist}`)
}

// 2. copy dist → dist/docs
console.log(`[bundle-docs] copying ${docsDist} → ${bundledDocs}`)
await rm(bundledDocs, { recursive: true, force: true })
await cp(docsDist, bundledDocs, { recursive: true })

console.log('[bundle-docs] done.')

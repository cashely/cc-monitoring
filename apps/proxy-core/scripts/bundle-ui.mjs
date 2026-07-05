#!/usr/bin/env node
// 发布前打包：
// 1. 构建 proxy-cli 静态资源
// 2. 拷贝到 proxy-core/dist/ui（发布产物内自包含）
// 3. 给 dist/cli/index.js 注入 shebang + 可执行权限
import { execSync } from 'node:child_process'
import { cp, rm, chmod, readFile, writeFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const coreRoot = path.resolve(__dirname, '..')
const monorepoRoot = path.resolve(coreRoot, '../..')
const cliRoot = path.resolve(coreRoot, '../proxy-cli')
const cliDist = path.join(cliRoot, 'dist')
const bundledUi = path.join(coreRoot, 'dist/ui')
const cliEntry = path.join(coreRoot, 'dist/cli/index.js')

// 1. build proxy-cli
console.log('[bundle-ui] building @cc-monitoring/proxy-cli ...')
execSync('pnpm --filter @cc-monitoring/proxy-cli build', {
  cwd: monorepoRoot,
  stdio: 'inherit'
})

try {
  await stat(cliDist)
} catch {
  throw new Error(`proxy-cli dist not found at ${cliDist}`)
}

// 2. copy dist → dist/ui
console.log(`[bundle-ui] copying ${cliDist} → ${bundledUi}`)
await rm(bundledUi, { recursive: true, force: true })
await cp(cliDist, bundledUi, { recursive: true })

// 3. shebang + chmod for bin
const src = await readFile(cliEntry, 'utf8')
if (!src.startsWith('#!')) {
  await writeFile(cliEntry, `#!/usr/bin/env node\n${src}`)
  console.log('[bundle-ui] shebang injected into dist/cli/index.js')
}
await chmod(cliEntry, 0o755)
console.log('[bundle-ui] done.')

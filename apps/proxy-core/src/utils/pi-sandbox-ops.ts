// 为 pi-coding-agent 的文件工具提供沙箱白名单 operations，
// 把所有 fs 访问限定在 ~/.cc-monitoring/docs/ 目录内。
// 边界判定（docsDir 内 / 受管 index.json）委托 vault。
import { promises as fs } from 'node:fs'
import { vault } from './vault.js'

/**
 * 校验传入路径必须在 docsDir 内，并返回归一化后的绝对路径。
 * 越界则抛错，阻断 fs 调用。
 */
function assertInside(absPath: string): string {
  return vault.assertInside(absPath)
}

/**
 * 守卫：index.json 由 add_topic/add_chunk 工具原子维护，
 * 禁止 LLM 通过 write/edit 直接改写。
 */
function assertNotManagedIndexJson(absPath: string): void {
  vault.assertNotManagedIndexJson(absPath)
}

// ============== write ==============
export const sandboxWriteOps = {
  async writeFile(absolutePath: string, content: string): Promise<void> {
    const p = assertInside(absolutePath)
    assertNotManagedIndexJson(p)
    await fs.writeFile(p, content, 'utf8')
  },
  async mkdir(dir: string): Promise<void> {
    const p = assertInside(dir)
    await fs.mkdir(p, { recursive: true })
  },
}

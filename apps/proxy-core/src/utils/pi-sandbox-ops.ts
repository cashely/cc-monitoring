// 为 pi-coding-agent 的文件工具提供沙箱白名单 operations，
// 把所有 fs 访问限定在 ~/.cc-monitoring/docs/ 目录内。
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { dataDir } from './paths.js'

// 知识文档目录：所有读写都必须落在它下面
const docsDir = path.join(dataDir, 'docs')

/**
 * 校验传入路径必须在 docsDir 内，并返回归一化后的绝对路径。
 * 越界则抛错，阻断 fs 调用。
 */
export function assertInside(absPath: string): string {
  const resolved = path.resolve(absPath)
  if (resolved !== docsDir && !resolved.startsWith(docsDir + path.sep)) {
    throw new Error(
      `Access denied: ${absPath} is outside the knowledge directory ${docsDir}`,
    )
  }
  return resolved
}

/**
 * 守卫：index.json 由 add_topic/add_chunk 工具原子维护，
 * 禁止 LLM 通过 write/edit 直接改写。
 */
function assertNotManagedIndexJson(absPath: string): void {
  if (path.basename(absPath) === 'index.json') {
    throw new Error('index.json is managed by add_topic/add_chunk tools, do not write directly')
  }
}

// 统一 access：校验可读性
async function access(absolutePath: string): Promise<void> {
  const p = assertInside(absolutePath)
  await fs.access(p)
}

// ============== read ==============
export const sandboxReadOps = {
  async readFile(absolutePath: string): Promise<Buffer> {
    const p = assertInside(absolutePath)
    return fs.readFile(p)
  },
  access,
  // 沙箱内不做图片 MIME 检测（pi 会按非图片处理，足够用）
  detectImageMimeType: async (): Promise<string | null | undefined> => undefined,
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

// ============== edit ==============
export const sandboxEditOps = {
  async readFile(absolutePath: string): Promise<Buffer> {
    const p = assertInside(absolutePath)
    return fs.readFile(p)
  },
  async writeFile(absolutePath: string, content: string): Promise<void> {
    const p = assertInside(absolutePath)
    assertNotManagedIndexJson(p)
    await fs.writeFile(p, content, 'utf8')
  },
  access,
}

// ============== grep ==============
// GrepOperations.readFile 签名是 Promise<string> | string（用于返回上下文行）
export const sandboxGrepOps = {
  async isDirectory(absolutePath: string): Promise<boolean> {
    // 越界直接 throw，让 pi 在 spawn rg 之前就 reject
    const p = assertInside(absolutePath)
    const st = await fs.stat(p)
    return st.isDirectory()
  },
  async readFile(absolutePath: string): Promise<string> {
    const p = assertInside(absolutePath)
    return fs.readFile(p, 'utf8')
  },
}

// ============== find ==============
export const sandboxFindOps = {
  async exists(absolutePath: string): Promise<boolean> {
    const p = assertInside(absolutePath)
    try {
      await fs.access(p)
      return true
    } catch {
      return false
    }
  },
  async glob(
    pattern: string,
    cwd: string,
    options: { ignore: string[]; limit: number },
  ): Promise<string[]> {
    // cwd 必须落在 docsDir 内
    const root = assertInside(cwd)
    // 递归收集 root 下所有文件的相对 posix 路径，再按 pattern + ignore 过滤
    const all: string[] = []
    async function walk(dir: string): Promise<void> {
      if (all.length >= options.limit * 4) return
      let entries: import('node:fs').Dirent[]
      try {
        entries = await fs.readdir(dir, { withFileTypes: true })
      } catch {
        return
      }
      for (const ent of entries) {
        const full = path.join(dir, ent.name)
        const rel = path.relative(root, full).split(path.sep).join('/')
        if (options.ignore.some((ig) => globMatch(rel, ig))) continue
        if (ent.isDirectory()) {
          await walk(full)
        } else if (ent.isFile()) {
          all.push(rel)
        }
      }
    }
    await walk(root)
    // 按 pattern 过滤，截断到 limit
    // 语义对齐 fd：pattern 不含 '/' 时按 basename 匹配任意深度；
    // 含 '/' 时按完整相对路径匹配（等价 '**/<pattern>'）
    const hasSlash = pattern.includes('/')
    const out = all
      .filter((r) =>
        hasSlash ? globMatch(r, pattern) : matchSegment(pattern, path.posix.basename(r)),
      )
      .slice(0, options.limit)
    return out
  },
}

// 极简 glob：支持 *、**、?，与 minimatch 在常见文档搜索场景下等价
//  - '*.md'           匹配顶层 md 文件
//  - '**/*.md'        匹配任意层级 md
//  - 'docs/**'        匹配 docs 子树下所有文件
//  - 'src/foo.ts'     字面路径
export function globMatch(relPosixPath: string, pattern: string): boolean {
  // 显式 '**' 段处理
  const patternSegs = pattern.split('/')
  const pathSegs = relPosixPath.split('/')
  return matchSegs(patternSegs, pathSegs, 0, 0)
}

function matchSegs(
  pats: string[],
  paths: string[],
  pi: number,
  qi: number,
): boolean {
  if (pi === pats.length) {
    return qi === paths.length
  }
  const p = pats[pi]
  if (p === '**') {
    // '**' 匹配 0..n 段（含跨目录）
    // 试：消耗 0 段；以及让 '**' 吃掉 q 到末尾任意段
    if (matchSegs(pats, paths, pi + 1, qi)) return true
    for (let k = qi; k < paths.length; k++) {
      if (matchSegs(pats, paths, pi + 1, k + 1)) return true
    }
    return false
  }
  if (qi === paths.length) return false
  if (!matchSegment(p, paths[qi])) return false
  return matchSegs(pats, paths, pi + 1, qi + 1)
}

function matchSegment(pattern: string, segment: string): boolean {
  if (pattern === '*') return true
  // 把 *、? 转成正则，其余字符转义
  let re = '^'
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i]
    if (ch === '*') {
      re += '[^/]*'
    } else if (ch === '?') {
      re += '[^/]'
    } else if ('.+^${}()|\\'.includes(ch)) {
      re += '\\' + ch
    } else {
      re += ch
    }
  }
  re += '$'
  try {
    return new RegExp(re).test(segment)
  } catch {
    return false
  }
}

// ============== ls ==============
export const sandboxLsOps = {
  async exists(absolutePath: string): Promise<boolean> {
    const p = assertInside(absolutePath)
    try {
      await fs.access(p)
      return true
    } catch {
      return false
    }
  },
  async stat(absolutePath: string): Promise<{ isDirectory: () => boolean }> {
    const p = assertInside(absolutePath)
    const st = await fs.stat(p)
    // fs.Stats 自带 isDirectory()，形状已满足 LsOperations
    return st
  },
  async readdir(absolutePath: string): Promise<string[]> {
    const p = assertInside(absolutePath)
    return fs.readdir(p)
  },
}

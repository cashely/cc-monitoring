import { runEgoBrowser } from './pi-browser-tools.js'

export interface CrawledPage {
  url: string
  text: string
}

export interface CrawlOptions {
  maxPages?: number // 默认 20
  maxDepth?: number // 默认 1
  perPageTimeoutMs?: number // 默认 40000
  signal?: AbortSignal
}

export const CRAWL_MAX_PAGES = 20
export const CRAWL_MAX_DEPTH = 1

// ---------- 纯函数辅助 ----------

const GENERIC_SEGMENTS = new Set(['docs', 'doc'])

/** 单段清洗：小写 + 非 a-z0-9 字符折叠成 -（不做首尾裁剪，留给上层统一处理） */
function cleanSegment(seg: string): string {
  return seg.toLowerCase().replace(/[^a-z0-9]+/g, '-')
}

/** 校验 slug 合法性，非法兜底 'topic' */
function finalizeSlug(slug: string): string {
  const s = slug
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/, '')
  return /^[a-z0-9][a-z0-9-]*$/.test(s) ? s : 'topic'
}

/**
 * 从 URL 生成 slug。
 * host 取去 www. 后的首个 DNS label（pi.dev → pi），pathname 最多取 3 个非泛段。
 */
export function slugFromUrl(raw: string): string {
  const u = new URL(raw)
  const hostLabel = u.hostname.replace(/^www\./, '').split('.')[0]
  const segments = [cleanSegment(hostLabel)]
  for (const part of u.pathname.split('/')) {
    const seg = cleanSegment(part)
    if (seg && !GENERIC_SEGMENTS.has(seg)) segments.push(seg)
  }
  return finalizeSlug(segments.slice(0, 4).join('-'))
}

/** 从文件名/标签生成 slug：取 basename、去扩展名后清洗，空则 'topic' */
export function slugFromLabel(label: string): string {
  const base = label.split(/[\\/]/).pop() ?? label
  const stem = base.replace(/\.[^.]+$/, '')
  return finalizeSlug(cleanSegment(stem))
}

/** 同站判定：去 www.、小写后相等，或 h 是 base 的子域 */
export function isSameSite(hostname: string, baseHostname: string): boolean {
  const norm = (h: string) => h.toLowerCase().replace(/^www\./, '')
  const h = norm(hostname)
  const base = norm(baseHostname)
  return h === base || h.endsWith(`.${base}`)
}

const BINARY_EXTENSIONS =
  /\.(pdf|zip|rar|7z|exe|dmg|pkg|png|jpg|jpeg|gif|svg|webp|mp3|mp4|mov|avi|doc|docx|xls|xlsx|ppt|pptx)$/i

/** 解析候选链接：仅 http(s)、清 hash、排除二进制/文档资源；无法解析返回 null */
export function normalizeCandidate(href: string, entry: URL): URL | null {
  let u: URL
  try {
    u = new URL(href, entry)
  } catch {
    return null
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
  u.hash = ''
  if (BINARY_EXTENSIONS.test(u.pathname)) return null
  return u
}

// ---------- 抓取 ----------

/** 单页浏览器脚本：打开 tab → SPA 缓冲 → 提取正文与链接 */
function buildPageScript(url: string): string {
  const extractExpr = `(() => {
  const text = document.body ? document.body.innerText : ''
  const links = Array.from(document.querySelectorAll('a[href]')).map(a => a.href)
  return { text, links }
})()`
  return `await openOrReuseTab(${JSON.stringify(url)}, { wait: true, timeout: 20 })
await js("new Promise(r=>setTimeout(r,600))")
const result = await js(${JSON.stringify(extractExpr)})
cliLog(JSON.stringify(result))
`
}

interface ExtractedResult {
  text?: unknown
  links?: unknown
}

/**
 * 代码确定性多页抓取（node 侧 BFS）。
 * 入口页抓取/解析失败硬抛错；其余页失败跳过。
 */
export async function crawlSite(
  entryUrl: string,
  opts: CrawlOptions = {},
  onPage?: (url: string, index: number, phase: 'start' | 'done' | 'failed') => void,
): Promise<CrawledPage[]> {
  const maxPages = opts.maxPages ?? CRAWL_MAX_PAGES
  const maxDepth = opts.maxDepth ?? CRAWL_MAX_DEPTH
  const perPageTimeoutMs = opts.perPageTimeoutMs ?? 40000

  const entry = new URL(entryUrl)
  entry.hash = ''
  const baseHostname = entry.hostname.replace(/^www\./, '')

  const pages: CrawledPage[] = []
  const seen = new Set<string>([entry.href])
  const queue: { url: string; depth: number }[] = [{ url: entry.href, depth: 0 }]

  while (queue.length > 0 && pages.length < maxPages) {
    const { url, depth } = queue.shift()!
    onPage?.(url, pages.length, 'start')

    let raw: string
    try {
      raw = await runEgoBrowser(buildPageScript(url), {
        timeoutMs: perPageTimeoutMs,
        signal: opts.signal,
      })
    } catch (err) {
      if (pages.length === 0) throw err
      onPage?.(url, pages.length, 'failed')
      continue
    }

    let result: ExtractedResult
    try {
      result = JSON.parse(raw) as ExtractedResult
    } catch {
      if (pages.length === 0) {
        throw new Error(`crawlSite: failed to parse result from ${url}`)
      }
      onPage?.(url, pages.length, 'failed')
      continue
    }

    const text = typeof result.text === 'string' ? result.text.trim() : ''
    if (text) {
      pages.push({ url, text })
      onPage?.(url, pages.length - 1, 'done')
    } else {
      onPage?.(url, pages.length, 'failed')
    }

    if (depth < maxDepth && Array.isArray(result.links)) {
      for (const link of result.links) {
        if (seen.size >= maxPages) break
        if (typeof link !== 'string') continue
        const candidate = normalizeCandidate(link, entry)
        if (!candidate) continue
        if (!isSameSite(candidate.hostname, baseHostname)) continue
        if (seen.has(candidate.href)) continue
        seen.add(candidate.href)
        queue.push({ url: candidate.href, depth: depth + 1 })
      }
    }
  }

  return pages
}

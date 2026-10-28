// web-crawler：抓取相关纯函数（slug 生成 / 同站判定 / 候选链接归一）与抓取上限常量。
// 渐进抓取的有状态逻辑见 pi-crawl-tools.ts（CrawlGuard）。

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

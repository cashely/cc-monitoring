// crawl 阶段工具：LLM Agent 在 outline 阶段内自己驱动渐进抓取。
// - CrawlGuard：同站/深度/页数硬校验的有状态抓取器，抓取过的原文存内存缓存，
//   saveSource 落盘到 <slug>/sources/source-NNN.md
// - createCrawlTools：挂给 pi session 的 4 个工具（crawl_open/crawl_visit/
//   save_source/crawl_finish），错误以文本返回，LLM 可读可恢复

import fs from 'node:fs'
import path from 'node:path'
import { Type } from 'typebox'
import type { ToolDefinition } from '@earendil-works/pi-coding-agent'
import { runEgoBrowser } from './pi-browser-tools.js'
import { CRAWL_MAX_PAGES, CRAWL_MAX_DEPTH, isSameSite, normalizeCandidate } from './web-crawler.js'

export interface NavigatedPage {
  title: string
  text: string
  links: string[]
}

interface PageData extends NavigatedPage {
  url: string
}

export interface CrawlGuardOptions {
  entryUrl: string
  docsDir: string
  slug: string
  maxPages?: number // 默认 CRAWL_MAX_PAGES
  maxDepth?: number // 默认 CRAWL_MAX_DEPTH
  /** 可注入的单页抓取（测试用）；默认调 runEgoBrowser；signal 用于中断在途抓取 */
  navigate?: (url: string, signal?: AbortSignal) => Promise<NavigatedPage>
}

/** 单页浏览器脚本：task space 取 tab → goto → networkidle 缓冲 → 稳定性轮询 → 提取标题/正文/链接 */
function buildCrawlScript(url: string): string {
  return `const pages = await task.pages()
const page = pages.find(p => p.label === 'p1') ?? pages[0] ?? await task.newPage()
await page.goto(${JSON.stringify(url)}, { waitUntil: 'load', timeout: 30000 })
try { await page.waitForLoadState('networkidle', { timeout: 5000 }) } catch {}
// 稳定性：500ms 采一次 innerText.length，连续 2 次相同且 >0，最多 10 次
await page.evaluate(() => new Promise((resolve) => {
  let last = -1, same = 0, n = 0
  const tick = () => {
    const len = document.body ? document.body.innerText.length : 0
    if (len > 0 && len === last) {
      same += 1
      if (same >= 2) return resolve()
    } else {
      same = 0
    }
    last = len
    if (++n >= 10) return resolve()
    setTimeout(tick, 500)
  }
  tick()
}))
const data = await page.evaluate(() => ({
  title: document.title,
  text: document.body ? document.body.innerText : '',
  links: Array.from(document.querySelectorAll('a[href]')).map(a => a.href),
}))
cliLog(JSON.stringify(data))
`
}

export interface SaveSourceResult {
  savedCount: number
  reused: boolean
}

export class CrawlGuard {
  private readonly maxPages: number
  private readonly maxDepth: number
  private readonly navigate: (url: string, signal?: AbortSignal) => Promise<NavigatedPage>

  private entry!: URL
  private readonly seen = new Set<string>()
  private readonly depthByUrl = new Map<string, number>()
  private readonly rawCache = new Map<string, NavigatedPage>()
  // 已落盘过的 URL（防重复原料）
  private readonly savedUrls = new Set<string>()
  private _savedCount = 0
  private currentDepth = 0

  constructor(private readonly opts: CrawlGuardOptions) {
    this.maxPages = opts.maxPages ?? CRAWL_MAX_PAGES
    this.maxDepth = opts.maxDepth ?? CRAWL_MAX_DEPTH
    this.navigate = opts.navigate ?? ((url, signal) => this.defaultNavigate(url, signal))
  }

  /** 默认单页抓取：跑 ego 脚本，JSON parse 失败硬抛错；signal 透传中断在途进程 */
  private async defaultNavigate(url: string, signal?: AbortSignal): Promise<NavigatedPage> {
    const raw = await runEgoBrowser(buildCrawlScript(url), { timeoutMs: 60000, signal })
    let data: any
    try {
      data = JSON.parse(raw)
    } catch {
      throw new Error(`crawl: failed to parse result from ${url}`)
    }
    return {
      title: typeof data.title === 'string' ? data.title : '',
      text: typeof data.text === 'string' ? data.text : '',
      links: Array.isArray(data.links) ? data.links.filter((l: unknown) => typeof l === 'string') : [],
    }
  }

  /** 打开入口页：URL 校验 + 初始状态；signal 用于中断在途抓取 */
  async open(signal?: AbortSignal): Promise<PageData> {
    const entry = new URL(this.opts.entryUrl)
    entry.hash = ''
    this.entry = entry
    this.seen.add(entry.href)
    this.depthByUrl.set(entry.href, 0)
    this.currentDepth = 0
    const page = await this.navigate(entry.href, signal)
    this.rawCache.set(entry.href, page)
    return { url: entry.href, ...page }
  }

  /**
   * 解析候选页的 BFS 最短深度：扫描每个已抓来源页的 links，
   * 凡归一后命中候选页的来源，候选深度 = 来源深度 + 1，取所有命中的最小值。
   * 一个来源都没查到（幻觉 URL）时硬抛错，绝不放行。
   */
  private resolveDepth(candidate: URL): number {
    let resolved: number | null = null
    for (const [sourceHref, page] of this.rawCache) {
      for (const link of page.links) {
        const linked = normalizeCandidate(link, this.entry)
        if (linked && linked.href === candidate.href) {
          const next = this.depthByUrl.get(sourceHref)! + 1
          if (resolved === null || next < resolved) resolved = next
          break // 本来源页已命中，不必再看它其余 links
        }
      }
    }
    if (resolved === null) {
      throw new Error(`crawl visit reject: ${candidate.href} not linked from any crawled page`)
    }
    return resolved
  }

  /** 访问子页：同站/seen/链接来源/深度/页数硬校验（原因 cross-site/seen/not linked/max-depth/max-pages） */
  async visit(rawUrl: string, signal?: AbortSignal): Promise<PageData> {
    const candidate = normalizeCandidate(rawUrl, this.entry)
    if (!candidate) throw new Error(`crawl visit reject: invalid or binary url: ${rawUrl}`)
    if (!isSameSite(candidate.hostname, this.entry.hostname)) {
      throw new Error(`crawl visit reject cross-site: ${candidate.href}`)
    }
    if (this.seen.has(candidate.href)) {
      throw new Error(`crawl visit reject seen: ${candidate.href}`)
    }
    // BFS 最短深度（候选必须由某个已抓页链接；未链接直接 throw）
    const nextDepth = this.resolveDepth(candidate)
    if (nextDepth > this.maxDepth) {
      throw new Error(`crawl visit reject max-depth: ${candidate.href}`)
    }
    if (this.seen.size + 1 > this.maxPages) {
      throw new Error(`crawl visit reject max-pages: ${candidate.href}`)
    }

    const page = await this.navigate(candidate.href, signal)
    this.seen.add(candidate.href)
    this.depthByUrl.set(candidate.href, nextDepth)
    this.currentDepth = nextDepth
    this.rawCache.set(candidate.href, page)
    return { url: candidate.href, ...page }
  }

  /**
   * 保存已抓取页原文到 <slug>/sources/source-NNN.md；必须先 open/visit 过该 URL。
   * 同页重复保存不写新文件，返回已有编号 + reused=true；空正文页判失败。
   */
  saveSource(rawUrl: string): SaveSourceResult {
    let key = rawUrl
    const candidate = normalizeCandidate(rawUrl, this.entry)
    if (candidate) key = candidate.href
    const page = this.rawCache.get(key)
    if (!page) throw new Error(`save_source reject: url not crawled: ${rawUrl}`)

    // 已存过：不重复落盘，返回已有编号
    if (this.savedUrls.has(key)) {
      return { savedCount: this._savedCount, reused: true }
    }
    // 对齐旧 crawlSite：trim 后为空的页面判失败，不产生空原料
    if (page.text.trim() === '') throw new Error(`save_source reject empty page: ${key}`)

    const sourcesDir = path.join(this.opts.docsDir, this.opts.slug, 'sources')
    fs.mkdirSync(sourcesDir, { recursive: true })
    const name = `source-${String(this._savedCount + 1).padStart(3, '0')}.md`
    fs.writeFileSync(path.join(sourcesDir, name), `Source: ${key}\n\n${page.text}`, 'utf8')
    this.savedUrls.add(key)
    this._savedCount += 1
    return { savedCount: this._savedCount, reused: false }
  }

  get savedCount(): number {
    return this._savedCount
  }

  /**
   * 抓取结束清理：no-op。
   * 不能调 task.finish()——它会关闭全部 page 并把 space 所有权交还 user，
   * 导致下一次 learn 的 taskSpace() resume 失败；持久 space 与 tab 留给后续复用。
   */
  async close(): Promise<void> {}
}

// ============================================================
// ToolDefinition 构造（写法对齐 pi-runtime，ok/err 返回）
// ============================================================

const ok = (text: string) => ({
  content: [{ type: 'text' as const, text }],
  details: undefined,
})
const errAsText = (e: unknown) =>
  ok(`error: ${e instanceof Error ? e.message : String(e)}`)

export function createCrawlTools(guard: CrawlGuard): ToolDefinition[] {
  return [
    {
      name: 'crawl_open',
      label: 'crawl_open',
      description: '打开本次任务的入口 URL，返回标题、正文与同站链接。抓取第一步调用。',
      parameters: Type.Object({}),
      async execute(_id, _params: Record<string, never>, signal?: AbortSignal) {
        try {
          return ok(JSON.stringify(await guard.open(signal)))
        } catch (e) {
          return errAsText(e)
        }
      },
    },
    {
      name: 'crawl_visit',
      label: 'crawl_visit',
      description: '访问入口同站的子页面（必须是 crawl_open/上一次 crawl_visit 返回链接中的 http(s) 页面）。',
      parameters: Type.Object({ url: Type.String({ description: '要访问的同站完整 URL' }) }),
      async execute(_id, params: { url: string }, signal?: AbortSignal) {
        try {
          return ok(JSON.stringify(await guard.visit(params.url, signal)))
        } catch (e) {
          return errAsText(e)
        }
      },
    },
    {
      name: 'save_source',
      label: 'save_source',
      description: '把当前已抓取页面的原文保存到本主题 sources/ 目录。每打开一页后调用一次；同页重复保存不写新文件。',
      parameters: Type.Object({ url: Type.String({ description: '刚抓取的页面 URL' }) }),
      async execute(_id, params: { url: string }) {
        try {
          // 直接返回 { savedCount, reused }
          return ok(JSON.stringify(guard.saveSource(params.url)))
        } catch (e) {
          return errAsText(e)
        }
      },
    },
    {
      name: 'crawl_finish',
      label: 'crawl_finish',
      description: '结束抓取：清理浏览器并返回已保存页数。无更多有价值链接或到达上限时调用。',
      parameters: Type.Object({}),
      async execute() {
        try {
          await guard.close()
          return ok(JSON.stringify({ finished: true, savedCount: guard.savedCount }))
        } catch (e) {
          return errAsText(e)
        }
      },
    },
  ]
}

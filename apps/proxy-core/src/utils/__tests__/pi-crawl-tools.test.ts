import { promises as fsp } from 'node:fs'
import path from 'node:path'
import os from 'node:os'

// Mock ego-browser：默认 navigate / close 均经 runEgoBrowser 子进程
jest.mock('../pi-browser-tools.js', () => ({
  runEgoBrowser: jest.fn(),
}))

import { runEgoBrowser } from '../pi-browser-tools.js'
import { CrawlGuard, createCrawlTools } from '../pi-crawl-tools.js'

const mockRunEgoBrowser = runEgoBrowser as jest.MockedFunction<typeof runEgoBrowser>

interface FixturePage {
  title: string
  text: string
  links: string[]
}

/** 构造一张 url -> 页面 的图；未登记的 URL navigate 抛错（模拟抓取失败） */
function makeGraphNav(graph: Record<string, FixturePage>): (url: string) => Promise<FixturePage> {
  return async (url: string) => {
    const page = graph[url]
    if (!page) throw new Error(`fixture missing: ${url}`)
    return { ...page }
  }
}

let tmpDir: string
const docsDir = () => path.join(tmpDir, 'docs')

beforeEach(async () => {
  tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'crawl-tools-'))
  mockRunEgoBrowser.mockReset()
})

afterEach(async () => {
  await fsp.rm(tmpDir, { recursive: true, force: true })
})

describe('CrawlGuard.open', () => {
  it('入口页登记为 depth 0 并返回页面信息', async () => {
    const guard = new CrawlGuard({
      entryUrl: 'https://pi.dev/',
      docsDir: docsDir(),
      slug: 'pi',
      navigate: makeGraphNav({
        'https://pi.dev/': { title: 'Pi', text: 'A text', links: ['https://pi.dev/b'] },
      }),
    })

    const page = await guard.open()
    expect(page).toEqual({
      url: 'https://pi.dev/',
      title: 'Pi',
      text: 'A text',
      links: ['https://pi.dev/b'],
    })
    expect(guard.savedCount).toBe(0)
  })

  it('入口 URL 非法时抛错', async () => {
    const guard = new CrawlGuard({
      entryUrl: 'not a url',
      docsDir: docsDir(),
      slug: 'pi',
      navigate: makeGraphNav({}),
    })
    await expect(guard.open()).rejects.toThrow()
  })

  it('未注入 navigate 时默认走 runEgoBrowser 并解析 JSON', async () => {
    mockRunEgoBrowser.mockResolvedValue(
      JSON.stringify({ title: 'T', text: 'X', links: ['https://pi.dev/b'] }),
    )
    const guard = new CrawlGuard({ entryUrl: 'https://pi.dev/', docsDir: docsDir(), slug: 'pi' })

    const page = await guard.open()
    expect(page.title).toBe('T')
    expect(page.text).toBe('X')
    expect(page.links).toEqual(['https://pi.dev/b'])
    // 抓取脚本 timeoutMs 60000，URL 以 JSON 字面量注入
    expect(mockRunEgoBrowser).toHaveBeenCalledWith(expect.any(String), { timeoutMs: 60000 })
    expect(mockRunEgoBrowser.mock.calls[0][0]).toContain(JSON.stringify('https://pi.dev/'))
    expect(mockRunEgoBrowser.mock.calls[0][0]).toContain('await task.newPage()')
  })

  it('浏览器输出 JSON parse 失败时抛错', async () => {
    mockRunEgoBrowser.mockResolvedValue('not-json')
    const guard = new CrawlGuard({ entryUrl: 'https://pi.dev/', docsDir: docsDir(), slug: 'pi' })
    await expect(guard.open()).rejects.toThrow(/parse/)
  })
})

describe('CrawlGuard.visit', () => {
  let graph: Record<string, FixturePage>
  beforeEach(() => {
    graph = {
      'https://pi.dev/': { title: 'A', text: 'A text', links: ['https://pi.dev/b'] },
      'https://pi.dev/b': { title: 'B', text: 'B text', links: ['https://pi.dev/c'] },
      'https://pi.dev/c': { title: 'C', text: 'C text', links: [] },
    }
  })

  it('同站子页推进深度（0 → 1），登记状态并返回页面信息', async () => {
    const guard = new CrawlGuard({ entryUrl: 'https://pi.dev/', docsDir: docsDir(), slug: 'pi', navigate: makeGraphNav(graph) })
    await guard.open()

    const page = await guard.visit('https://pi.dev/b')
    expect(page).toEqual({ url: 'https://pi.dev/b', title: 'B', text: 'B text', links: ['https://pi.dev/c'] })
    // 再访问 c：当前深度 1 + 1 = 2 > maxDepth(1) → 拒绝
    await expect(guard.visit('https://pi.dev/c')).rejects.toThrow(/max-depth/)
  })

  it('跨站链接 throw cross-site', async () => {
    graph['https://pi.dev/'].links.push('https://other.com/x')
    const guard = new CrawlGuard({ entryUrl: 'https://pi.dev/', docsDir: docsDir(), slug: 'pi', navigate: makeGraphNav(graph) })
    await guard.open()
    await expect(guard.visit('https://other.com/x')).rejects.toThrow(/cross-site/)
  })

  it('二进制资源链接 throw', async () => {
    graph['https://pi.dev/'].links.push('https://pi.dev/file.pdf')
    const guard = new CrawlGuard({ entryUrl: 'https://pi.dev/', docsDir: docsDir(), slug: 'pi', navigate: makeGraphNav(graph) })
    await guard.open()
    await expect(guard.visit('https://pi.dev/file.pdf')).rejects.toThrow()
  })

  it('已访问（seen，含纯锚点归一）throw seen', async () => {
    const guard = new CrawlGuard({ entryUrl: 'https://pi.dev/', docsDir: docsDir(), slug: 'pi', navigate: makeGraphNav(graph) })
    await guard.open()
    await expect(guard.visit('https://pi.dev/#section')).rejects.toThrow(/seen/)
  })

  it('maxDepth=0 时任何子页 throw max-depth', async () => {
    const guard = new CrawlGuard({ entryUrl: 'https://pi.dev/', docsDir: docsDir(), slug: 'pi', maxDepth: 0, navigate: makeGraphNav(graph) })
    await guard.open()
    await expect(guard.visit('https://pi.dev/b')).rejects.toThrow(/max-depth/)
  })

  it('maxPages=1 时将达页数上限 throw max-pages', async () => {
    const guard = new CrawlGuard({ entryUrl: 'https://pi.dev/', docsDir: docsDir(), slug: 'pi', maxPages: 1, navigate: makeGraphNav(graph) })
    await guard.open()
    await expect(guard.visit('https://pi.dev/b')).rejects.toThrow(/max-pages/)
  })

  it('BFS 深度：A links=[B,E]，visit B(d1) 后再 visit E 仍为 d1（线性深度旧实现会误拒）', async () => {
    const bfsGraph = {
      'https://pi.dev/': { title: 'A', text: 'A text', links: ['https://pi.dev/b', 'https://pi.dev/e'] },
      'https://pi.dev/b': { title: 'B', text: 'B text', links: [] },
      'https://pi.dev/e': { title: 'E', text: 'E text', links: [] },
    }
    const guard = new CrawlGuard({ entryUrl: 'https://pi.dev/', docsDir: docsDir(), slug: 'pi', navigate: makeGraphNav(bfsGraph) })
    await guard.open()
    await guard.visit('https://pi.dev/b')

    // E 由入口 A 链接，真实 BFS 深度=1，必须可访问
    const page = await guard.visit('https://pi.dev/e')
    expect(page.url).toBe('https://pi.dev/e')
    const depthByUrl: Map<string, number> = (guard as any).depthByUrl
    expect(depthByUrl.get('https://pi.dev/e')).toBe(1)
  })

  it('A links=[B]、B links=[C]：visit B(d1) 后 C 为 d2 > maxDepth，仍 throw max-depth', async () => {
    const chainGraph = {
      'https://pi.dev/': { title: 'A', text: 'A text', links: ['https://pi.dev/b'] },
      'https://pi.dev/b': { title: 'B', text: 'B text', links: ['https://pi.dev/c'] },
      'https://pi.dev/c': { title: 'C', text: 'C text', links: [] },
    }
    const guard = new CrawlGuard({ entryUrl: 'https://pi.dev/', docsDir: docsDir(), slug: 'pi', navigate: makeGraphNav(chainGraph) })
    await guard.open()
    await guard.visit('https://pi.dev/b')
    await expect(guard.visit('https://pi.dev/c')).rejects.toThrow(/max-depth/)
  })

  it('同一页被 d0 和 d1 两个来源链接时，深度取 min=1', async () => {
    const sharedGraph = {
      'https://pi.dev/': { title: 'A', text: 'A text', links: ['https://pi.dev/b', 'https://pi.dev/e'] },
      'https://pi.dev/b': { title: 'B', text: 'B text', links: ['https://pi.dev/e'] },
      'https://pi.dev/e': { title: 'E', text: 'E text', links: [] },
    }
    const guard = new CrawlGuard({ entryUrl: 'https://pi.dev/', docsDir: docsDir(), slug: 'pi', navigate: makeGraphNav(sharedGraph) })
    await guard.open()
    await guard.visit('https://pi.dev/b')

    // E 同时被 A(d0) 和 B(d1) 链接，取最短来源 → d1
    await guard.visit('https://pi.dev/e')
    const depthByUrl: Map<string, number> = (guard as any).depthByUrl
    expect(depthByUrl.get('https://pi.dev/e')).toBe(1)
  })

  it('未被任何已抓页链接的同站 URL → throw not linked（不放行幻觉 URL）', async () => {
    const guard = new CrawlGuard({
      entryUrl: 'https://pi.dev/',
      docsDir: docsDir(),
      slug: 'pi',
      navigate: makeGraphNav({ 'https://pi.dev/': { title: 'A', text: 'A text', links: [] } }),
    })
    await guard.open()
    await expect(guard.visit('https://pi.dev/ghost')).rejects.toThrow(/not linked from any crawled page/)
  })

  it('navigate reject 时 seen 不增加：再次 visit 同 URL 不报 seen（失败页不占名额）', async () => {
    const nav = jest.fn(async (url: string) => {
      if (url === 'https://pi.dev/b') throw new Error('nav boom')
      return { title: 'A', text: 'A text', links: ['https://pi.dev/b'] }
    })
    const guard = new CrawlGuard({ entryUrl: 'https://pi.dev/', docsDir: docsDir(), slug: 'pi', navigate: nav })
    await guard.open()

    await expect(guard.visit('https://pi.dev/b')).rejects.toThrow(/nav boom/)
    // 第二次仍因抓取失败报错，而不是 seen；seen 集合保持只有入口
    await expect(guard.visit('https://pi.dev/b')).rejects.toThrow(/nav boom/)
    const seen: Set<string> = (guard as any).seen
    expect(seen.size).toBe(1)
  })
})

describe('CrawlGuard.saveSource', () => {
  it('按 source-NNN.md 落盘，内容含 Source 头，savedCount 递增', async () => {
    const dir = docsDir()
    const guard = new CrawlGuard({
      entryUrl: 'https://pi.dev/',
      docsDir: dir,
      slug: 'pi',
      navigate: makeGraphNav({
        'https://pi.dev/': { title: 'A', text: 'A text', links: ['https://pi.dev/b'] },
        'https://pi.dev/b': { title: 'B', text: 'B text', links: [] },
      }),
    })
    await guard.open()
    expect(guard.saveSource('https://pi.dev/')).toEqual({ savedCount: 1, reused: false })

    await guard.visit('https://pi.dev/b')
    expect(guard.saveSource('https://pi.dev/b')).toEqual({ savedCount: 2, reused: false })

    const sourcesDir = path.join(dir, 'pi', 'sources')
    const f1 = await fsp.readFile(path.join(sourcesDir, 'source-001.md'), 'utf8')
    expect(f1).toBe('Source: https://pi.dev/\n\nA text')
    const f2 = await fsp.readFile(path.join(sourcesDir, 'source-002.md'), 'utf8')
    expect(f2).toBe('Source: https://pi.dev/b\n\nB text')
  })

  it('未抓取过的 URL saveSource throw', async () => {
    const guard = new CrawlGuard({
      entryUrl: 'https://pi.dev/',
      docsDir: docsDir(),
      slug: 'pi',
      navigate: makeGraphNav({ 'https://pi.dev/': { title: 'A', text: 'A', links: [] } }),
    })
    await guard.open()
    expect(() => guard.saveSource('https://pi.dev/ghost')).toThrow(/not crawled/)
  })

  it('同页重复 save_source：不写重复文件、reused=true、savedCount 不重复增', async () => {
    const dir = docsDir()
    const guard = new CrawlGuard({
      entryUrl: 'https://pi.dev/',
      docsDir: dir,
      slug: 'pi',
      navigate: makeGraphNav({ 'https://pi.dev/': { title: 'A', text: 'A text', links: [] } }),
    })
    await guard.open()

    const r1 = guard.saveSource('https://pi.dev/')
    const r2 = guard.saveSource('https://pi.dev/')
    expect(r1).toEqual({ savedCount: 1, reused: false })
    expect(r2).toEqual({ savedCount: 1, reused: true })
    expect(guard.savedCount).toBe(1)

    const files = await fsp.readdir(path.join(dir, 'pi', 'sources'))
    expect(files).toEqual(['source-001.md'])
  })

  it('空正文页 saveSource throw empty page', async () => {
    const guard = new CrawlGuard({
      entryUrl: 'https://pi.dev/',
      docsDir: docsDir(),
      slug: 'pi',
      navigate: makeGraphNav({
        'https://pi.dev/': { title: 'A', text: 'A text', links: ['https://pi.dev/b'] },
        'https://pi.dev/b': { title: 'B', text: '   \n  ', links: [] },
      }),
    })
    await guard.open()
    await guard.visit('https://pi.dev/b')
    expect(() => guard.saveSource('https://pi.dev/b')).toThrow(/empty page/)
  })
})

describe('CrawlGuard.close', () => {
  it('no-op：不起 ego-browser 进程，也不抛错', async () => {
    const guard = new CrawlGuard({
      entryUrl: 'https://pi.dev/',
      docsDir: docsDir(),
      slug: 'pi',
      navigate: makeGraphNav({ 'https://pi.dev/': { title: 'A', text: 'A text', links: [] } }),
    })
    await expect(guard.close()).resolves.toBeUndefined()
    expect(mockRunEgoBrowser).not.toHaveBeenCalled()
  })
})

describe('CrawlGuard signal 透传', () => {
  it('open/visit 把 abort signal 转发给 runEgoBrowser', async () => {
    mockRunEgoBrowser.mockResolvedValue(
      JSON.stringify({ title: 'A', text: 'A text', links: ['https://pi.dev/b'] }),
    )
    const guard = new CrawlGuard({ entryUrl: 'https://pi.dev/', docsDir: docsDir(), slug: 'pi' })
    const signal = new AbortController().signal

    await guard.open(signal)
    expect(mockRunEgoBrowser).toHaveBeenNthCalledWith(
      1, expect.any(String), { timeoutMs: 60000, signal },
    )

    await guard.visit('https://pi.dev/b', signal)
    expect(mockRunEgoBrowser).toHaveBeenNthCalledWith(
      2, expect.any(String), { timeoutMs: 60000, signal },
    )
  })

  it('crawl_open/crawl_visit 的 execute 把 signal 透传给 guard.navigate', async () => {
    const nav = jest.fn(async () => ({ title: 'A', text: 'A text', links: ['https://pi.dev/b'] }))
    const guard = new CrawlGuard({ entryUrl: 'https://pi.dev/', docsDir: docsDir(), slug: 'pi', navigate: nav })
    const tools = createCrawlTools(guard)
    const byName = Object.fromEntries(tools.map((t) => [t.name, t]))
    const signal = new AbortController().signal

    await byName.crawl_open.execute('id-1', {}, signal, undefined, {} as any)
    expect(nav).toHaveBeenNthCalledWith(1, 'https://pi.dev/', signal)

    await byName.crawl_visit.execute('id-2', { url: 'https://pi.dev/b' }, signal, undefined, {} as any)
    expect(nav).toHaveBeenNthCalledWith(2, 'https://pi.dev/b', signal)
  })
})

describe('createCrawlTools', () => {
  function makeGuard(): CrawlGuard {
    return new CrawlGuard({
      entryUrl: 'https://pi.dev/',
      docsDir: docsDir(),
      slug: 'pi',
      navigate: makeGraphNav({
        'https://pi.dev/': { title: 'A', text: 'A text', links: ['https://pi.dev/b', 'https://other.com/x'] },
        'https://pi.dev/b': { title: 'B', text: 'B text', links: [] },
      }),
    })
  }

  it('提供 crawl_open/crawl_visit/save_source/crawl_finish 四个工具', () => {
    const tools = createCrawlTools(makeGuard())
    expect(tools.map((t) => t.name)).toEqual(['crawl_open', 'crawl_visit', 'save_source', 'crawl_finish'])
  })

  it('工具错误以可读文本返回（不抛异常）', async () => {
    mockRunEgoBrowser.mockResolvedValue('closed')
    const guard = makeGuard()
    const tools = createCrawlTools(guard)
    const byName = Object.fromEntries(tools.map((t) => [t.name, t]))

    const textOf = (res: { content: Array<{ type: string; text?: string }> }) =>
      res.content.map((c) => c.text ?? '').join('\n')
    // execute 签名 5 参（id/params/signal/onUpdate/ctx），测试只需前 2 个
    const call = (tool: { execute: (...args: any[]) => Promise<any> }, params: any) =>
      tool.execute('id', params, undefined, undefined, undefined)

    const openRes = await call(byName.crawl_open, {})
    expect(textOf(openRes)).toContain('https://pi.dev/')

    const badRes = await call(byName.crawl_visit, { url: 'https://other.com/x' })
    expect(textOf(badRes)).toMatch(/error:.*cross-site/)

    const saveRes = await call(byName.save_source, { url: 'https://pi.dev/' })
    expect(textOf(saveRes)).toContain('"savedCount":1')

    const finishRes = await call(byName.crawl_finish, {})
    expect(textOf(finishRes)).toContain('"finished":true')
  })
})

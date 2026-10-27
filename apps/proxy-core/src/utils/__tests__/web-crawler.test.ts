// Mock 浏览器能力：根据脚本里 openOrReuseTab 的 URL 返回构造 JSON，绝不真实跑浏览器
jest.mock('../pi-browser-tools.js', () => ({
  runEgoBrowser: jest.fn(),
}))

import { runEgoBrowser } from '../pi-browser-tools.js'
import {
  crawlSite,
  slugFromUrl,
  slugFromLabel,
  isSameSite,
  normalizeCandidate,
} from '../web-crawler.js'

const mockRunEgoBrowser = runEgoBrowser as jest.MockedFunction<typeof runEgoBrowser>

interface PageFixture {
  text: string
  links: string[]
}

/** 从注入脚本里提取 openOrReuseTab 的 URL 字面量 */
function extractUrl(script: string): string {
  const m = script.match(/openOrReuseTab\(\s*("(?:[^"\\]|\\.)*")/)
  return m ? (JSON.parse(m[1]) as string) : ''
}

/** 安装一张 url -> 页面 的图；未登记的 URL 模拟抓取失败 */
function installGraph(graph: Record<string, PageFixture>): void {
  const fixtures = new Map<string, string>()
  for (const [url, page] of Object.entries(graph)) {
    fixtures.set(url, JSON.stringify(page))
  }
  mockRunEgoBrowser.mockImplementation(async (script: string) => {
    const url = extractUrl(script)
    const payload = fixtures.get(url)
    if (!payload) throw new Error(`fixture not found: ${url}`)
    return payload
  })
}

beforeEach(() => {
  mockRunEgoBrowser.mockReset()
})

describe('slugFromUrl', () => {
  it('bare host without path', () => {
    expect(slugFromUrl('https://pi.dev')).toBe('pi')
  })

  it('drops generic docs segment', () => {
    expect(slugFromUrl('https://pi.dev/docs/intro')).toBe('pi-intro')
  })

  it('strips www and keeps at most 3 path segments', () => {
    expect(slugFromUrl('https://www.example.com/a/b/c/d')).toBe('example-a-b-c')
  })

  it('ignores query and hash', () => {
    expect(slugFromUrl('https://pi.dev/x?y=1#z')).toBe('pi-x')
  })

  it('throws on invalid url', () => {
    expect(() => slugFromUrl('not a url')).toThrow()
  })
})

describe('slugFromLabel', () => {
  it('strips extension from ascii filename', () => {
    expect(slugFromLabel('react-hooks.md')).toBe('react-hooks')
  })

  it('keeps the ascii stem and washes non-ascii chars away', () => {
    expect(slugFromLabel('Pi 介绍.docx')).toBe('pi')
  })

  it('falls back to topic when nothing ascii remains', () => {
    expect(slugFromLabel('介绍.docx')).toBe('topic')
  })

  it('takes basename and cleans spaces case-insensitively', () => {
    expect(slugFromLabel('/tmp/dir/My Note.TXT')).toBe('my-note')
  })
})

describe('isSameSite', () => {
  it('subdomain is same site', () => {
    expect(isSameSite('blog.pi.dev', 'pi.dev')).toBe(true)
  })

  it('www is equivalent to bare host', () => {
    expect(isSameSite('www.pi.dev', 'pi.dev')).toBe(true)
  })

  it('cross domain is not same site', () => {
    expect(isSameSite('other.com', 'pi.dev')).toBe(false)
  })

  it('suffix-without-dot is not same site', () => {
    expect(isSameSite('notpi.dev', 'pi.dev')).toBe(false)
  })
})

describe('normalizeCandidate', () => {
  const entry = new URL('https://pi.dev/')

  it('passes a normal http(s) link', () => {
    const u = normalizeCandidate('https://pi.dev/a', entry)
    expect(u?.href).toBe('https://pi.dev/a')
  })

  it('resolves relative links against entry', () => {
    const u = normalizeCandidate('/about', entry)
    expect(u?.href).toBe('https://pi.dev/about')
  })

  it('rejects non-http protocols like mailto', () => {
    expect(normalizeCandidate('mailto:a@b.com', entry)).toBeNull()
  })

  it('excludes binary/document extensions', () => {
    expect(normalizeCandidate('https://pi.dev/file.pdf', entry)).toBeNull()
    expect(normalizeCandidate('https://pi.dev/PIC.JPG', entry)).toBeNull()
  })

  it('clears the hash', () => {
    const u = normalizeCandidate('https://pi.dev/a#section', entry)
    expect(u?.href).toBe('https://pi.dev/a')
    expect(u?.hash).toBe('')
  })
})

describe('crawlSite', () => {
  it('crawls same-site BFS graph, filters cross-site / binary / duplicates, respects depth', async () => {
    installGraph({
      'https://pi.dev/': {
        text: 'A text',
        links: [
          'https://pi.dev/b',
          'https://other.com/c',
          'https://pi.dev/file.pdf',
          'https://pi.dev/#section',
        ],
      },
      'https://pi.dev/b': { text: 'B text', links: ['https://pi.dev/c'] },
      'https://pi.dev/c': { text: 'C text', links: [] },
    })

    const controller = new AbortController()
    const onPage = jest.fn()
    const pages = await crawlSite(
      'https://pi.dev',
      { perPageTimeoutMs: 999, signal: controller.signal },
      onPage,
    )

    // 只抓入口 A 与同站 B；C 位于 depth 2（maxDepth=1）不抓；跨站/二进制/重复不入队
    expect(pages).toEqual([
      { url: 'https://pi.dev/', text: 'A text' },
      { url: 'https://pi.dev/b', text: 'B text' },
    ])

    const fetchedUrls = mockRunEgoBrowser.mock.calls.map(([script]) => extractUrl(script))
    expect(fetchedUrls).toEqual(['https://pi.dev/', 'https://pi.dev/b'])

    // onPage：每页抓取前 'start'，成功入 pages 后 'done'；index = 已抓页数，同页两相一致
    expect(onPage).toHaveBeenCalledTimes(4)
    expect(onPage).toHaveBeenNthCalledWith(1, 'https://pi.dev/', 0, 'start')
    expect(onPage).toHaveBeenNthCalledWith(2, 'https://pi.dev/', 0, 'done')
    expect(onPage).toHaveBeenNthCalledWith(3, 'https://pi.dev/b', 1, 'start')
    expect(onPage).toHaveBeenNthCalledWith(4, 'https://pi.dev/b', 1, 'done')

    // perPageTimeoutMs / signal 透传给每页 runEgoBrowser
    expect(mockRunEgoBrowser).toHaveBeenNthCalledWith(
      1,
      expect.any(String),
      { timeoutMs: 999, signal: controller.signal },
    )
    expect(mockRunEgoBrowser).toHaveBeenNthCalledWith(
      2,
      expect.any(String),
      { timeoutMs: 999, signal: controller.signal },
    )
  })

  it('skips failed non-entry pages and keeps crawling the rest', async () => {
    installGraph({
      'https://pi.dev/': { text: 'A', links: ['https://pi.dev/b', 'https://pi.dev/c'] },
      // B 未登记 → 抓取失败
      'https://pi.dev/c': { text: 'C', links: [] },
    })

    const onPage = jest.fn()
    const pages = await crawlSite('https://pi.dev/', undefined, onPage)

    expect(pages).toEqual([
      { url: 'https://pi.dev/', text: 'A' },
      { url: 'https://pi.dev/c', text: 'C' },
    ])
    // B 失败不计入已抓页数，因此 C 的 index 仍是 1
    // 成功页先 'start' 后 'done'；失败子页 B 先 'start' 后 'failed'
    expect(onPage).toHaveBeenCalledTimes(6)
    expect(onPage).toHaveBeenNthCalledWith(1, 'https://pi.dev/', 0, 'start')
    expect(onPage).toHaveBeenNthCalledWith(2, 'https://pi.dev/', 0, 'done')
    expect(onPage).toHaveBeenNthCalledWith(3, 'https://pi.dev/b', 1, 'start')
    expect(onPage).toHaveBeenNthCalledWith(4, 'https://pi.dev/b', 1, 'failed')
    expect(onPage).toHaveBeenNthCalledWith(5, 'https://pi.dev/c', 1, 'start')
    expect(onPage).toHaveBeenNthCalledWith(6, 'https://pi.dev/c', 1, 'done')
  })

  it('reports failed phase for a child page with empty text but keeps crawling', async () => {
    installGraph({
      'https://pi.dev/': { text: 'A', links: ['https://pi.dev/b', 'https://pi.dev/c'] },
      // B 返回空 text：不 push，按 failed 处理
      'https://pi.dev/b': { text: '   ', links: [] },
      'https://pi.dev/c': { text: 'C', links: [] },
    })

    const onPage = jest.fn()
    const pages = await crawlSite('https://pi.dev/', undefined, onPage)

    expect(pages).toEqual([
      { url: 'https://pi.dev/', text: 'A' },
      { url: 'https://pi.dev/c', text: 'C' },
    ])
    // 空文本子页 B：start 后直接 failed，无 done
    expect(onPage).toHaveBeenNthCalledWith(3, 'https://pi.dev/b', 1, 'start')
    expect(onPage).toHaveBeenNthCalledWith(4, 'https://pi.dev/b', 1, 'failed')
    // C 的 index 仍是 1
    expect(onPage).toHaveBeenNthCalledWith(5, 'https://pi.dev/c', 1, 'start')
    expect(onPage).toHaveBeenNthCalledWith(6, 'https://pi.dev/c', 1, 'done')
  })

  it('rejects when the entry page fails to fetch', async () => {
    installGraph({}) // 入口无 fixture → runEgoBrowser reject
    await expect(crawlSite('https://pi.dev/')).rejects.toThrow(/fixture not found/)
  })

  it('rejects when the entry result is not valid JSON', async () => {
    mockRunEgoBrowser.mockResolvedValue('not-json{')
    await expect(crawlSite('https://pi.dev/')).rejects.toThrow(/failed to parse result/)
  })
})

import {
  slugFromUrl,
  slugFromLabel,
  isSameSite,
  normalizeCandidate,
} from '../web-crawler.js'

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

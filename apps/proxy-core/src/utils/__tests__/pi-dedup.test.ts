jest.mock('../pi-runtime.js', () => ({ runJsonPrompt: jest.fn() }))
import { findCandidates, mergeTopics, assertNoOldDirs } from '../pi-dedup.js'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// ---- mergeTopics / assertNoOldDirs：真实 tmpDir 手工铺盘 ----

const pad3 = (n: number) => String(n).padStart(3, '0')

// 铺一个 topic：sources 为正文数组（按序 source-NNN）；chunks 为 { id?, body }
function layoutTopic(
  docsDir: string,
  slug: string,
  opts: { sources?: string[]; chunks?: Array<{ id?: string; body: string }> } = {},
) {
  const topicDir = path.join(docsDir, slug)
  fs.mkdirSync(path.join(topicDir, 'sources'), { recursive: true })
  fs.mkdirSync(path.join(topicDir, 'chunks'), { recursive: true })
  for (let i = 0; i < (opts.sources ?? []).length; i++) {
    fs.writeFileSync(path.join(topicDir, 'sources', `source-${pad3(i + 1)}.md`), opts.sources![i])
  }
  const chunks = (opts.chunks ?? []).map((c, i) => {
    const id = c.id ?? `chunk-${pad3(i + 1)}`
    fs.writeFileSync(path.join(topicDir, 'chunks', `${id}.md`), c.body)
    return { id, title: id, summary: '', tags: [] }
  })
  fs.writeFileSync(
    path.join(topicDir, 'index.json'),
    JSON.stringify({ slug, title: slug, summary: '', tags: [], chunks }),
  )
}

function writeRoot(docsDir: string, slugs: string[]) {
  fs.writeFileSync(
    path.join(docsDir, 'index.json'),
    JSON.stringify({ topics: slugs.map(slug => ({ slug, title: slug, summary: '', tags: [] })) }),
  )
}

function freshTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'pi-dedup-'))
}

test('findCandidates: title 归一相等命中并排前', () => {
  const topics = [
    { slug: 'a', title: 'React Hooks', summary: '', tags: [] },
    { slug: 'b', title: 'Other', summary: '', tags: [] },
  ]
  expect(findCandidates({ title: 'react  hooks!', tags: [] }, topics).map(t => t.slug)).toEqual(['a'])
})
test('findCandidates: tag 相交命中', () => {
  const topics = [{ slug: 'c', title: 'X', summary: '', tags: ['state-management'] }]
  expect(findCandidates({ title: 'zzz', tags: ['State Management'] }, topics)).toHaveLength(1)
})
test('findCandidates: 无命中返回 []', () => {
  expect(findCandidates({ title: 'qqq', tags: [] }, [{ slug: 'd', title: 'rrr', summary: '', tags: [] }])).toEqual([])
})

test('mergeTopics: 两边都有 → sources 续号、chunks 重编号、refs 合并、根 index 移除 src', () => {
  const tmp = freshTmp()
  layoutTopic(tmp, 'dsta', { sources: ['dst source'], chunks: [{ body: 'dst chunk' }] })
  layoutTopic(tmp, 'newb', { sources: ['src source'], chunks: [{ body: 'src c1' }, { body: 'src c2' }] })
  writeRoot(tmp, ['dsta', 'newb', 'other'])

  expect(mergeTopics(tmp, 'newb', 'dsta')).toBe(3)
  expect(fs.readdirSync(path.join(tmp, 'dsta', 'sources')).sort())
    .toEqual(['source-001.md', 'source-002.md'])
  expect(fs.readdirSync(path.join(tmp, 'dsta', 'chunks')).sort())
    .toEqual(['chunk-001.md', 'chunk-002.md', 'chunk-003.md'])
  // src 目录已删；根 index 无 newb，其余保留
  expect(fs.existsSync(path.join(tmp, 'newb'))).toBe(false)
  const root = JSON.parse(fs.readFileSync(path.join(tmp, 'index.json'), 'utf8'))
  expect(root.topics.map((t: { slug: string }) => t.slug)).toEqual(['dsta', 'other'])
  // refs 已合并进 dst index
  const dstIndex = JSON.parse(fs.readFileSync(path.join(tmp, 'dsta', 'index.json'), 'utf8'))
  expect(dstIndex.chunks.map((c: { id: string }) => c.id))
    .toEqual(['chunk-001', 'chunk-002', 'chunk-003'])
})

test('mergeTopics: src 无 chunks（门1）→ 只移 sources，返回 dst 原 chunk 数', () => {
  const tmp = freshTmp()
  layoutTopic(tmp, 'dsta', { sources: ['dst source'], chunks: [{ body: 'dst chunk' }] })
  layoutTopic(tmp, 'newb', { sources: ['src source 1', 'src source 2'] })
  writeRoot(tmp, ['dsta', 'newb'])

  expect(mergeTopics(tmp, 'newb', 'dsta')).toBe(1)
  expect(fs.readdirSync(path.join(tmp, 'dsta', 'chunks')).sort()).toEqual(['chunk-001.md'])
  expect(fs.readdirSync(path.join(tmp, 'dsta', 'sources')).sort())
    .toEqual(['source-001.md', 'source-002.md', 'source-003.md'])
})

test('mergeTopics: dst 无 chunks（门0）→ src chunks 从 chunk-001 起重编号并入', () => {
  const tmp = freshTmp()
  layoutTopic(tmp, 'dsta', {})
  layoutTopic(tmp, 'newb', { chunks: [{ body: 'src c1' }, { body: 'src c2' }] })
  writeRoot(tmp, ['dsta', 'newb'])

  expect(mergeTopics(tmp, 'newb', 'dsta')).toBe(2)
  expect(fs.readdirSync(path.join(tmp, 'dsta', 'chunks')).sort())
    .toEqual(['chunk-001.md', 'chunk-002.md'])
  expect(fs.readFileSync(path.join(tmp, 'dsta', 'chunks', 'chunk-001.md'), 'utf8')).toBe('src c1')
  expect(fs.readFileSync(path.join(tmp, 'dsta', 'chunks', 'chunk-002.md'), 'utf8')).toBe('src c2')
})

test('mergeTopics: chunk 正文逐字不变（含花括号与换行）', () => {
  const tmp = freshTmp()
  layoutTopic(tmp, 'dsta', { chunks: [{ body: 'dst chunk' }] })
  const body = '{\n  "key": "值 {braces}\n换行"\n}\n最后一行\n'
  layoutTopic(tmp, 'newb', { chunks: [{ body }] })
  writeRoot(tmp, ['dsta', 'newb'])

  mergeTopics(tmp, 'newb', 'dsta')
  // src chunk-001 偏移为 dst chunk-002，正文逐字一致
  expect(fs.readFileSync(path.join(tmp, 'dsta', 'chunks', 'chunk-002.md'), 'utf8')).toBe(body)
})

test('mergeTopics: src 与 dst 相同 → 抛错防自合并', () => {
  const tmp = freshTmp()
  layoutTopic(tmp, 't', {})
  writeRoot(tmp, ['t'])
  expect(() => mergeTopics(tmp, 't', 't')).toThrow('mergeTopics: src 与 dst 相同')
})

test('assertNoOldDirs: 存在 x.old → 抛精确错误；无 → 不抛', () => {
  const withOld = freshTmp()
  fs.mkdirSync(path.join(withOld, 'x.old'))
  expect(() => assertNoOldDirs(withOld)).toThrow('检测到未清理的旁挂目录 x.old，请手工处理后再学习')

  const clean = freshTmp()
  fs.mkdirSync(path.join(clean, 'normal-slug'))
  expect(() => assertNoOldDirs(clean)).not.toThrow()
})

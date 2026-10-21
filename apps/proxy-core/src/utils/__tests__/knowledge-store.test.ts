import { promises as fs } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { createKnowledgeStore } from '../knowledge-store.js'

async function makeTmpDocs(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'kb-test-'))
  // 根 INDEX.md
  await fs.writeFile(path.join(dir, 'INDEX.md'),
    '# 知识主题清单\n\n- [react-hooks](react-hooks/) — React hooks 用法\n', 'utf8')
  // 主题文件夹
  await fs.mkdir(path.join(dir, 'react-hooks', 'chunks'), { recursive: true })
  await fs.writeFile(path.join(dir, 'react-hooks', 'INDEX.md'),
    '---\ntitle: React Hooks 参考\ntags: [react, hooks]\nchunkCount: 1\n---\n\n# React Hooks 参考\n\n## 片段清单\n- [chunk-001](chunks/chunk-001.md) — useState：状态管理\n', 'utf8')
  await fs.writeFile(path.join(dir, 'react-hooks', 'chunks', 'chunk-001.md'),
    '---\ntitle: useState 状态管理\n---\n\nuseState 用于组件状态。', 'utf8')
  return dir
}

describe('knowledge-store', () => {
  it('listTopics 解析根 INDEX.md', async () => {
    const root = await makeTmpDocs()
    const store = createKnowledgeStore(root)
    const topics = await store.listTopics()
    expect(topics).toEqual([{ slug: 'react-hooks', title: 'react-hooks', summary: 'React hooks 用法' }])
  })

  it('listTopics 根 INDEX 不存在返回空数组', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'kb-empty-'))
    const store = createKnowledgeStore(dir)
    expect(await store.listTopics()).toEqual([])
  })

  it('getTopic 返回元数据 + 片段清单', async () => {
    const root = await makeTmpDocs()
    const store = createKnowledgeStore(root)
    const detail = await store.getTopic('react-hooks')
    expect(detail.title).toBe('React Hooks 参考')
    expect(detail.tags).toEqual(['react', 'hooks'])
    expect(detail.chunks).toEqual([{ id: 'chunk-001', title: 'useState：状态管理', summary: 'useState：状态管理' }])
  })

  it('readChunk 返回单片正文', async () => {
    const root = await makeTmpDocs()
    const store = createKnowledgeStore(root)
    const text = await store.readChunk('react-hooks', 'chunk-001')
    expect(text).toContain('useState 用于组件状态')
  })

  it('readChunk 拒绝路径穿越', async () => {
    const root = await makeTmpDocs()
    const store = createKnowledgeStore(root)
    await expect(store.readChunk('..', 'chunk-001')).rejects.toThrow()
    await expect(store.readChunk('react-hooks', '../chunk-001')).rejects.toThrow()
  })

  it('searchChunks 关键词命中返回清单', async () => {
    const root = await makeTmpDocs()
    const store = createKnowledgeStore(root)
    const hits = await store.searchChunks('useState')
    expect(hits).toEqual([{ topic: 'react-hooks', chunkId: 'chunk-001', title: 'useState 状态管理' }])
  })
})

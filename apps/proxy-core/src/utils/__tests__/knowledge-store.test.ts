import { promises as fs } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { createKnowledgeStore } from '../knowledge-store.js'

async function makeTmpDocs(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'kb-test-'))
  // 根 index.json
  await fs.writeFile(path.join(dir, 'index.json'),
    JSON.stringify({
      topics: [
        { slug: 'react-hooks', title: 'React Hooks 参考', summary: 'React hooks 用法', tags: ['react', 'hooks'] },
      ],
    }, null, 2), 'utf8')
  // 主题文件夹
  await fs.mkdir(path.join(dir, 'react-hooks', 'chunks'), { recursive: true })
  await fs.writeFile(path.join(dir, 'react-hooks', 'index.json'),
    JSON.stringify({
      slug: 'react-hooks',
      title: 'React Hooks 参考',
      summary: 'React hooks 用法',
      tags: ['react', 'hooks'],
      chunks: [{ id: 'chunk-001', title: '状态管理', summary: 'useState 用于组件状态' }],
    }, null, 2), 'utf8')
  await fs.writeFile(path.join(dir, 'react-hooks', 'chunks', 'chunk-001.md'),
    '# 状态管理：useState\n\nuseState 用于组件状态。', 'utf8')
  return dir
}

describe('knowledge-store', () => {
  it('listTopics 解析根 index.json', async () => {
    const root = await makeTmpDocs()
    const store = createKnowledgeStore(root)
    const topics = await store.listTopics()
    expect(topics).toEqual([
      { slug: 'react-hooks', title: 'React Hooks 参考', summary: 'React hooks 用法', tags: ['react', 'hooks'] },
    ])
  })

  it('listTopics 根 index.json 不存在返回空数组', async () => {
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
    expect(detail.chunks).toEqual([{ id: 'chunk-001', title: '状态管理', summary: 'useState 用于组件状态' }])
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
    expect(hits).toEqual([{ topic: 'react-hooks', chunkId: 'chunk-001', title: '状态管理：useState' }])
  })

  it('upsertTopic 两次不同 slug → listTopics 返回 2 条，不覆盖', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'kb-upsert-'))
    const store = createKnowledgeStore(dir)
    await store.upsertTopic({ slug: 'topic-a', title: 'A', summary: 'sa', tags: [] })
    await store.upsertTopic({ slug: 'topic-b', title: 'B', summary: 'sb', tags: ['x'] })
    const topics = await store.listTopics()
    expect(topics).toHaveLength(2)
    expect(topics.map(t => t.slug).sort()).toEqual(['topic-a', 'topic-b'])
  })

  it('upsertTopic 同 slug 再调更新 summary，chunks 数组不变，listTopics 仍 1 条', async () => {
    const root = await makeTmpDocs()
    const store = createKnowledgeStore(root)
    // 先登记一个额外 chunk ref
    await store.upsertChunkRef({ topic: 'react-hooks', chunkId: 'chunk-002', title: 'T2', summary: 'S2' })

    await store.upsertTopic({
      slug: 'react-hooks',
      title: 'React Hooks 参考',
      summary: 'updated summary',
      tags: ['react', 'hooks', 'new'],
    })

    const topics = await store.listTopics()
    expect(topics).toHaveLength(1)
    expect(topics[0].summary).toBe('updated summary')
    expect(topics[0].tags).toEqual(['react', 'hooks', 'new'])

    const detail = await store.getTopic('react-hooks')
    expect(detail.chunks).toHaveLength(2)
    expect(detail.chunks.map(c => c.id).sort()).toEqual(['chunk-001', 'chunk-002'])
  })

  it('upsertChunkRef 同 topic 两次不同 chunk_id → getTopic 返回 2 chunks', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'kb-chunk-'))
    const store = createKnowledgeStore(dir)
    await store.upsertTopic({ slug: 't1', title: 'T1', summary: 's', tags: [] })
    await store.upsertChunkRef({ topic: 't1', chunkId: 'chunk-001', title: 'c1', summary: 's1' })
    await store.upsertChunkRef({ topic: 't1', chunkId: 'chunk-002', title: 'c2', summary: 's2' })
    const detail = await store.getTopic('t1')
    expect(detail.chunks).toHaveLength(2)
    expect(detail.chunks.map(c => c.id)).toEqual(['chunk-001', 'chunk-002'])
  })

  it('upsertChunkRef topic 不存在 → rejects', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'kb-no-topic-'))
    const store = createKnowledgeStore(dir)
    await expect(
      store.upsertChunkRef({ topic: 'ghost', chunkId: 'chunk-001', title: 'c', summary: 's' }),
    ).rejects.toThrow(/topic not found: ghost/)
  })
})

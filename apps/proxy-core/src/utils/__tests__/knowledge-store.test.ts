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
    expect(detail.chunks).toEqual([{ id: 'chunk-001', title: '状态管理', summary: 'useState 用于组件状态', tags: [] }])
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
    await store.upsertChunkRef({ topic: 'react-hooks', chunkId: 'chunk-002', title: 'T2', summary: 'S2', tags: [] })

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
    await store.upsertChunkRef({ topic: 't1', chunkId: 'chunk-001', title: 'c1', summary: 's1', tags: [] })
    await store.upsertChunkRef({ topic: 't1', chunkId: 'chunk-002', title: 'c2', summary: 's2', tags: [] })
    const detail = await store.getTopic('t1')
    expect(detail.chunks).toHaveLength(2)
    expect(detail.chunks.map(c => c.id)).toEqual(['chunk-001', 'chunk-002'])
  })

  it('upsertChunkRef topic 不存在 → rejects', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'kb-no-topic-'))
    const store = createKnowledgeStore(dir)
    await expect(
      store.upsertChunkRef({ topic: 'ghost', chunkId: 'chunk-001', title: 'c', summary: 's', tags: [] }),
    ).rejects.toThrow(/topic not found: ghost/)
  })

  it('tags: upsertChunkRef 落盘 tags，重复调用覆写 tags', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'kb-tags-'))
    const store = createKnowledgeStore(dir)
    await store.upsertTopic({ slug: 't1', title: 'T1', summary: 's', tags: [] })
    await store.upsertChunkRef({ topic: 't1', chunkId: 'chunk-001', title: 'c1', summary: 's1', tags: ['redis', '缓存'] })

    // 落盘验证
    const raw = JSON.parse(await fs.readFile(path.join(dir, 't1', 'index.json'), 'utf8'))
    expect(raw.chunks[0].tags).toEqual(['redis', '缓存'])

    // 读回
    const detail = await store.getTopic('t1')
    expect(detail.chunks[0].tags).toEqual(['redis', '缓存'])

    // 同 chunk 再调 → tags 被覆写
    await store.upsertChunkRef({ topic: 't1', chunkId: 'chunk-001', title: 'c1', summary: 's1', tags: ['new'] })
    const detail2 = await store.getTopic('t1')
    expect(detail2.chunks[0].tags).toEqual(['new'])
  })

  it('tags: 旧 chunk（无 tags 字段）读回为 []，不抛错', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'kb-oldtags-'))
    await fs.mkdir(path.join(dir, 'old', 'chunks'), { recursive: true })
    await fs.writeFile(path.join(dir, 'old', 'index.json'), JSON.stringify({
      slug: 'old', title: 'Old', summary: 'so', tags: [],
      chunks: [{ id: 'chunk-001', title: 'oc', summary: 'os' }],
    }), 'utf8')
    const store = createKnowledgeStore(dir)
    const detail = await store.getTopic('old')
    expect(detail.chunks[0].tags).toEqual([])
  })

  it('searchChunks 五路匹配：body / title / summary / topic.tags / chunk.tags', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'kb-redis-'))
    await fs.mkdir(path.join(dir, 'redis', 'chunks'), { recursive: true })
    await fs.writeFile(path.join(dir, 'redis', 'index.json'), JSON.stringify({
      slug: 'redis', title: 'Redis', summary: 'sr', tags: ['nosql'],
      chunks: [
        { id: 'chunk-001', title: '缓存详解', summary: '缓存摘要', tags: ['缓存', 'cache', 'KV存储'] },
        { id: 'chunk-002', title: '主从复制', summary: 'replication 摘要', tags: [] },
      ],
    }), 'utf8')
    await fs.writeFile(path.join(dir, 'redis', 'chunks', 'chunk-001.md'),
      '# 缓存详解\n\n正文讲缓存。', 'utf8')
    await fs.writeFile(path.join(dir, 'redis', 'chunks', 'chunk-002.md'),
      '# 故障转移\n\n正文讲哨兵。', 'utf8')
    const store = createKnowledgeStore(dir)

    // body
    expect(await store.searchChunks('缓存')).toEqual([
      { topic: 'redis', chunkId: 'chunk-001', title: '缓存详解' },
    ])
    // chunk.tags
    expect(await store.searchChunks('cache')).toEqual([
      { topic: 'redis', chunkId: 'chunk-001', title: '缓存详解' },
    ])
    // topic.tags（命中该 topic 下所有 chunk）
    expect(await store.searchChunks('nosql')).toEqual([
      { topic: 'redis', chunkId: 'chunk-001', title: '缓存详解' },
      { topic: 'redis', chunkId: 'chunk-002', title: '故障转移' },
    ])
    // title（chunk-002 正文不含「主从复制」）
    expect(await store.searchChunks('主从复制')).toEqual([
      { topic: 'redis', chunkId: 'chunk-002', title: '故障转移' },
    ])
    // summary
    expect(await store.searchChunks('replication')).toEqual([
      { topic: 'redis', chunkId: 'chunk-002', title: '故障转移' },
    ])
    // 无命中
    expect(await store.searchChunks('不存在的词xyz')).toEqual([])
  })

  it('searchChunks 旧数据 chunk 无 tags 字段仍按 body 命中', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'kb-oldsearch-'))
    await fs.mkdir(path.join(dir, 'redis', 'chunks'), { recursive: true })
    await fs.writeFile(path.join(dir, 'redis', 'index.json'), JSON.stringify({
      slug: 'redis', title: 'Redis', summary: 'sr', tags: ['nosql'],
      chunks: [{ id: 'chunk-001', title: '缓存详解', summary: '缓存摘要' }],
    }), 'utf8')
    await fs.writeFile(path.join(dir, 'redis', 'chunks', 'chunk-001.md'),
      '# 缓存详解\n\n正文讲缓存。', 'utf8')
    const store = createKnowledgeStore(dir)
    expect(await store.searchChunks('缓存')).toEqual([
      { topic: 'redis', chunkId: 'chunk-001', title: '缓存详解' },
    ])
    // 旧数据 chunk 无 tags：搜 chunk tag 不命中，但 topic.tags 仍命中
    expect(await store.searchChunks('nosql')).toEqual([
      { topic: 'redis', chunkId: 'chunk-001', title: '缓存详解' },
    ])
  })
})

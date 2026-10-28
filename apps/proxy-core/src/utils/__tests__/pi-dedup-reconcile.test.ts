jest.mock('../pi-runtime.js', () => ({ runJsonPrompt: jest.fn() }))
import { mkdtemp, mkdir, writeFile } from 'fs/promises'
import os from 'os'
import path from 'path'
import { runJsonPrompt } from '../pi-runtime.js'
import { reconcileTopics, readAllTopics, readTopicDetail, mintSlug } from '../pi-dedup.js'

const mockJson = runJsonPrompt as jest.MockedFunction<typeof runJsonPrompt>
let tmp: string

beforeEach(async () => {
  tmp = await mkdtemp(path.join(os.tmpdir(), 'pi-dedup-'))
  mockJson.mockReset()
})

test('预筛命中 → 调 LLM，match=true 透传 targetSlug/mergedTitle/itemsToAdd', async () => {
  mockJson.mockResolvedValue({ match: true, targetSlug: 'a', mergedTitle: 'M', confidence: 0.62,
    itemsToAdd: [{ id: 'x', title: 'X', oneLine: 'x' }] })
  const r = await reconcileTopics({ port: 1, docsDir: tmp, wantItems: true,
    candidate: { slug: 'new', title: 'React Hooks', tags: [] },
    targets: [{ slug: 'a', title: 'React Hooks', summary: '', tags: [], chunks: [] }] })
  expect(r.match).toBe(true); expect(r.targetSlug).toBe('a'); expect(r.itemsToAdd).toHaveLength(1)
})
test('LLM 抛错（坏 JSON）→ 安全返回 match=false', async () => {
  mockJson.mockRejectedValue(new Error('no json object in response'))
  await expect(reconcileTopics({ port: 1, docsDir: tmp, wantItems: false,
    candidate: { slug: 'new', title: 'T', tags: [] },
    targets: [{ slug: 'a', title: 'T', summary: '', tags: [], chunks: [] }] }))
    .resolves.toMatchObject({ match: false })
})
test('预筛空且目标>20 → 不调 LLM，match=false', async () => {
  const targets = Array.from({ length: 21 }, (_, i) =>
    ({ slug: `s${i}`, title: `Distinct ${i}`, summary: '', tags: [], chunks: [] }))
  const r = await reconcileTopics({ port: 1, docsDir: tmp, wantItems: false,
    candidate: { slug: 'new', title: 'zzzz-noise', tags: [] }, targets })
  expect(r.match).toBe(false); expect(mockJson).not.toHaveBeenCalled()
})

test('readAllTopics: 返回 index.json 的 topics', async () => {
  await writeFile(path.join(tmp, 'index.json'), JSON.stringify({
    topics: [{ slug: 'a', title: 'A', summary: '', tags: [] }],
  }))
  await expect(readAllTopics(tmp)).resolves.toMatchObject([{ slug: 'a', title: 'A' }])
})
test('readAllTopics: 空/缺失目录返回 []', async () => {
  await expect(readAllTopics(tmp)).resolves.toEqual([])
})
describe('mintSlug', () => {
  test('LLM 返回合法且空闲的 slug → 直接使用', async () => {
    mockJson.mockResolvedValue({ slug: 'react-hooks' })
    await expect(mintSlug({ port: 1, title: 'React Hooks', existing: [] })).resolves.toBe('react-hooks')
  })
  test('LLM 返回非法 slug → 降级 slugFromLabel(title)', async () => {
    mockJson.mockResolvedValue({ slug: 'Bad Slug!' })
    await expect(mintSlug({ port: 1, title: 'Hello World', existing: [] })).resolves.toBe('hello-world')
  })
  test('LLM slug 与 slugFromLabel(title) 均被占 → 追加 -2', async () => {
    mockJson.mockResolvedValue({ slug: 'my-topic' })
    await expect(mintSlug({ port: 1, title: 'My Topic', existing: ['my-topic'] }))
      .resolves.toBe('my-topic-2')
  })
})

test('readTopicDetail: 返回 <slug>/index.json 解析结果；缺失返回 null', async () => {
  await mkdir(path.join(tmp, 'a'))
  await writeFile(path.join(tmp, 'a', 'index.json'), JSON.stringify({
    slug: 'a', title: 'A', summary: 's', tags: ['t'], chunks: [],
  }))
  await expect(readTopicDetail(tmp, 'a')).resolves.toMatchObject({ slug: 'a', chunks: [] })
  await expect(readTopicDetail(tmp, 'missing')).resolves.toBeNull()
})

jest.mock('../pi-runtime.js', () => ({ runJsonPrompt: jest.fn() }))
import { findCandidates } from '../pi-dedup.js'

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

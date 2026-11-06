import Database from 'better-sqlite3'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { configureDbPath, initDatabase, closeDatabase, getDatabase } from '../db.js'
import {
  insertRunning,
  markCompleted,
  markFailed,
  markAborted,
  recoverCrashedTasks,
} from '../learn-tasks-db.js'

describe('learn-tasks-db', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = mkdtempSync(path.join(tmpdir(), 'ccm-lt-'))
    configureDbPath(path.join(tempDir, 'test.db'))
    initDatabase()
  })

  afterEach(() => {
    closeDatabase()
    rmSync(tempDir, { recursive: true, force: true })
  })

  function getRow(taskId: string): any {
    return getDatabase().prepare('SELECT * FROM learn_tasks WHERE task_id = ?').get(taskId)
  }

  test('insertRunning 落 running 行且字段正确', () => {
    const { taskId } = insertRunning(getDatabase(), {
      slug: 'my-slug',
      sourceType: 'url',
      label: 'https://x.com/',
    })
    const row = getRow(taskId)
    expect(row).toMatchObject({
      task_id: taskId,
      slug: 'my-slug',
      source_type: 'url',
      label: 'https://x.com/',
      status: 'running',
    })
    expect(row.error).toBeNull()
    expect(row.ended_at).toBeNull()
    expect(typeof row.created_at).toBe('string')
  })

  test('不同 slug 可同时 running；同 slug 第二次 insertRunning 撞 partial unique 约束', () => {
    const db = getDatabase()
    insertRunning(db, { slug: 'slug-a', sourceType: 'url', label: 'a' })
    expect(() =>
      insertRunning(db, { slug: 'slug-b', sourceType: 'file', label: 'b' }),
    ).not.toThrow()

    expect(() =>
      insertRunning(db, { slug: 'slug-a', sourceType: 'file', label: 'a2' }),
    ).toThrow(/UNIQUE constraint failed/)
  })

  const terminalCases: Array<[
    string,
    (db: Database.Database, taskId: string) => void,
  ]> = [
    ['completed', (db, taskId) => markCompleted(db, taskId)],
    ['failed', (db, taskId) => markFailed(db, taskId, 'boom')],
    ['aborted', (db, taskId) => markAborted(db, taskId)],
  ]

  test.each(terminalCases)(
    '终态 %s：写 ended_at 后同 slug 可再次 insertRunning',
    (status, transition) => {
      const db = getDatabase()
      const { taskId } = insertRunning(db, { slug: 'slug-x', sourceType: 'url', label: 'a' })
      transition(db, taskId)

      const row = getRow(taskId)
      expect(row.status).toBe(status)
      expect(typeof row.ended_at).toBe('string')

      const again = insertRunning(db, { slug: 'slug-x', sourceType: 'url', label: 'a2' })
      expect(getRow(again.taskId).status).toBe('running')
    },
  )

  test('markFailed 写入 error 与 ended_at', () => {
    const db = getDatabase()
    const { taskId } = insertRunning(db, { slug: 'f', sourceType: 'file', label: 'f.md' })
    markFailed(db, taskId, 'something broke')

    const row = getRow(taskId)
    expect(row.status).toBe('failed')
    expect(row.error).toBe('something broke')
    expect(typeof row.ended_at).toBe('string')
  })

  test('recoverCrashedTasks：running → crashed 且返回计数；非 running 行不动；recover 后同 slug 可再跑', () => {
    const db = getDatabase()
    const r1 = insertRunning(db, { slug: 's1', sourceType: 'url', label: 'a' })
    const r2 = insertRunning(db, { slug: 's2', sourceType: 'url', label: 'b' })
    markCompleted(db, r2.taskId)

    expect(recoverCrashedTasks(db)).toBe(1)

    const crashed = getRow(r1.taskId)
    expect(crashed.status).toBe('crashed')
    expect(typeof crashed.ended_at).toBe('string')
    expect(getRow(r2.taskId).status).toBe('completed')

    // crashed 释放 partial unique 守卫，同 slug 可再跑
    const again = insertRunning(db, { slug: 's1', sourceType: 'url', label: 'c' })
    expect(getRow(again.taskId).status).toBe('running')
  })
})

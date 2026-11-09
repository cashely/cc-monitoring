import Database from 'better-sqlite3'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { vacuumDatabase } from '../db-maintenance.js'

describe('vacuumDatabase', () => {
  let db: Database.Database
  let dbFile: string

  beforeEach(() => {
    dbFile = path.join(os.tmpdir(), `db-maintenance-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.db`)
    db = new Database(dbFile)
    db.pragma('journal_mode = WAL')
    db.exec('CREATE TABLE items (id INTEGER PRIMARY KEY, payload TEXT)')
  })

  afterEach(() => {
    db.close()
    for (const suffix of ['', '-wal', '-shm']) {
      try { fs.unlinkSync(dbFile + suffix) } catch {}
    }
  })

  test('首次调用：NONE(0) → INCREMENTAL(2)，VACUUM 收缩空闲页', () => {
    // 新库默认 auto_vacuum = 0
    expect(db.pragma('auto_vacuum', { simple: true })).toBe(0)

    const insert = db.prepare('INSERT INTO items (payload) VALUES (?)')
    for (let i = 0; i < 2000; i++) {
      insert.run(`payload-${i}`)
    }

    // 删除全部：auto_vacuum=0 时空闲页不归还，page_count 仍虚高
    db.prepare('DELETE FROM items').run()

    const result = vacuumDatabase(db)

    expect(result.autoVacuumBefore).toBe(0)
    expect(db.pragma('auto_vacuum', { simple: true })).toBe(2)
    expect(result.pagesAfter).toBeLessThan(result.pagesBefore)
    expect(result.pageSize).toBeGreaterThan(0)
  })

  test('第二次调用：走 incremental 分支，不报错且返回结构完整', () => {
    const insert = db.prepare('INSERT INTO items (payload) VALUES (?)')
    for (let i = 0; i < 2000; i++) {
      insert.run(`payload-${i}`)
    }
    db.prepare('DELETE FROM items').run()

    vacuumDatabase(db)
    const result = vacuumDatabase(db)

    expect(result.autoVacuumBefore).toBe(2)
    expect(result).toEqual(
      expect.objectContaining({
        autoVacuumBefore: 2,
        pagesBefore: expect.any(Number),
        pagesAfter: expect.any(Number),
        pageSize: expect.any(Number)
      })
    )
  })
})

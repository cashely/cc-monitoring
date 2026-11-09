import Database from 'better-sqlite3'

// auto_vacuum: 0=NONE, 1=FULL, 2=INCREMENTAL
export interface VacuumResult {
  autoVacuumBefore: number
  pagesBefore: number
  pagesAfter: number
  pageSize: number
}

// 回收空闲页。auto_vacuum 不是 INCREMENTAL 时，pragma 修改只对新建库生效，
// 已有库必须先 VACUUM 全库重写才能让 pragma 生效；之后例行调用走
// incremental_vacuum，只还页不重写，代价低。
export function vacuumDatabase(db: Database.Database): VacuumResult {
  const autoVacuumBefore = (db.pragma('auto_vacuum', { simple: true }) as number) ?? 0
  const pagesBefore = db.pragma('page_count', { simple: true }) as number
  const pageSize = db.pragma('page_size', { simple: true }) as number

  if (autoVacuumBefore !== 2) {
    db.pragma('auto_vacuum = INCREMENTAL')
    // 首次：全库重写，pragma 在重写后生效
    db.exec('VACUUM')
  } else {
    db.pragma('incremental_vacuum')
  }

  const pagesAfter = db.pragma('page_count', { simple: true }) as number

  return { autoVacuumBefore, pagesBefore, pagesAfter, pageSize }
}

// learn_tasks 数据层：learn 流水线状态机落库
// running → completed / failed / aborted；启动回收的无主 running → crashed。
// 同 slug 并发运行由 partial unique index idx_learn_tasks_running_slug 硬守。

import Database from 'better-sqlite3'
import { randomUUID } from 'node:crypto'

export interface InsertRunningArgs {
  slug: string
  sourceType: 'url' | 'file'
  label: string
}

/** 落 running 行；撞同 slug 唯一约束时错误原样抛出（SQLITE_CONSTRAINT_UNIQUE） */
export function insertRunning(db: Database.Database, args: InsertRunningArgs): { taskId: string } {
  const taskId = randomUUID()
  db.prepare(`
    INSERT INTO learn_tasks (task_id, slug, source_type, label, status)
    VALUES (?, ?, ?, ?, 'running')
  `).run(taskId, args.slug, args.sourceType, args.label)
  return { taskId }
}

export function markCompleted(db: Database.Database, taskId: string): void {
  db.prepare(`
    UPDATE learn_tasks SET status = 'completed', ended_at = ? WHERE task_id = ?
  `).run(new Date().toISOString(), taskId)
}

export function markFailed(db: Database.Database, taskId: string, error: string): void {
  db.prepare(`
    UPDATE learn_tasks SET status = 'failed', error = ?, ended_at = ? WHERE task_id = ?
  `).run(error, new Date().toISOString(), taskId)
}

export function markAborted(db: Database.Database, taskId: string): void {
  db.prepare(`
    UPDATE learn_tasks SET status = 'aborted', ended_at = ? WHERE task_id = ?
  `).run(new Date().toISOString(), taskId)
}

/** 回收无主 running 行为 crashed（服务启动时调用），返回回收行数 */
export function recoverCrashedTasks(db: Database.Database): number {
  const info = db.prepare(`
    UPDATE learn_tasks SET status = 'crashed', ended_at = ? WHERE status = 'running'
  `).run(new Date().toISOString())
  return info.changes
}

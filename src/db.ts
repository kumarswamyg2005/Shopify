import Database from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

export function openDb(path: string): Database.Database {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true })
  const db = new Database(path)
  db.pragma('journal_mode = WAL')
  migrate(db)
  return db
}

export function migrate(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS clients (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      shopify_store TEXT NOT NULL,
      theme_repo_path TEXT NOT NULL,
      brand_file_path TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY,
      clickup_task_id TEXT NOT NULL,
      client_id TEXT,
      type TEXT CHECK(type IN ('theme','admin')),
      kind TEXT NOT NULL CHECK(kind IN ('initial','revision','publish','execute')),
      status TEXT NOT NULL CHECK(status IN ('queued','running','awaiting_review','done','failed')),
      round INTEGER,
      unpublished_theme_id TEXT,
      preview_url TEXT,
      plan_json TEXT,
      plan_hash TEXT,
      error TEXT,
      started_at TEXT,
      finished_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS jobs_task_idx ON jobs(clickup_task_id);
    CREATE INDEX IF NOT EXISTS jobs_status_idx ON jobs(status);

    CREATE TABLE IF NOT EXISTS webhook_events (
      history_item_id TEXT PRIMARY KEY,
      event TEXT NOT NULL,
      task_id TEXT NOT NULL,
      received_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS audit (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id TEXT NOT NULL,
      tool TEXT NOT NULL,
      summary TEXT NOT NULL,
      ok INTEGER NOT NULL,
      duration_ms INTEGER NOT NULL,
      at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS task_state (
      clickup_task_id TEXT PRIMARY KEY,
      client_id TEXT NOT NULL,
      type TEXT CHECK(type IN ('theme','admin')),
      unpublished_theme_id TEXT,
      branch TEXT,
      round INTEGER NOT NULL DEFAULT 0,
      status TEXT,
      approved_plan_hash TEXT,
      last_comment_id TEXT
    );
  `)
}

export interface WebhookEventInput {
  historyItemId: string
  event: string
  taskId: string
}

/** Records a webhook history_items[].id; returns true if it was new, false if a duplicate (invariant 5). */
export function recordWebhookEvent(db: Database.Database, input: WebhookEventInput): boolean {
  const result = db
    .prepare('INSERT OR IGNORE INTO webhook_events (history_item_id, event, task_id) VALUES (?, ?, ?)')
    .run(input.historyItemId, input.event, input.taskId)
  return result.changes > 0
}

export interface JobInput {
  id: string
  clickupTaskId: string
  kind: 'initial' | 'revision' | 'publish' | 'execute'
  clientId?: string | undefined
  planHash?: string | undefined
}

export function enqueueJob(db: Database.Database, input: JobInput): void {
  db.prepare(
    `INSERT INTO jobs (id, clickup_task_id, kind, status, client_id, plan_hash) VALUES (?, ?, ?, 'queued', ?, ?)`,
  ).run(input.id, input.clickupTaskId, input.kind, input.clientId ?? null, input.planHash ?? null)
}

export function queueDepth(db: Database.Database): number {
  const row = db.prepare(`SELECT COUNT(*) as n FROM jobs WHERE status = 'queued'`).get() as { n: number }
  return row.n
}

export function lastJobAt(db: Database.Database): string | null {
  const row = db.prepare(`SELECT MAX(created_at) as at FROM jobs`).get() as { at: string | null }
  return row.at
}

export interface Job {
  id: string
  clickupTaskId: string
  clientId: string | null
  type: 'theme' | 'admin' | null
  kind: 'initial' | 'revision' | 'publish' | 'execute'
  status: 'queued' | 'running' | 'awaiting_review' | 'done' | 'failed'
  round: number | null
  unpublishedThemeId: string | null
  previewUrl: string | null
  planJson: string | null
  planHash: string | null
  error: string | null
}

function rowToJob(row: Record<string, unknown>): Job {
  return {
    id: row.id as string,
    clickupTaskId: row.clickup_task_id as string,
    clientId: row.client_id as string | null,
    type: row.type as Job['type'],
    kind: row.kind as Job['kind'],
    status: row.status as Job['status'],
    round: row.round as number | null,
    unpublishedThemeId: row.unpublished_theme_id as string | null,
    previewUrl: row.preview_url as string | null,
    planJson: row.plan_json as string | null,
    planHash: row.plan_hash as string | null,
    error: row.error as string | null,
  }
}

/** Atomically claims the oldest queued job, if any, marking it running. */
export function claimNextQueuedJob(db: Database.Database): Job | null {
  return db.transaction(() => {
    const row = db.prepare(`SELECT * FROM jobs WHERE status = 'queued' ORDER BY created_at ASC LIMIT 1`).get() as
      | Record<string, unknown>
      | undefined
    if (!row) return null
    db.prepare(`UPDATE jobs SET status = 'running', started_at = datetime('now') WHERE id = ?`).run(row.id)
    return rowToJob({ ...row, status: 'running' })
  })()
}

export function getJob(db: Database.Database, id: string): Job | null {
  const row = db.prepare('SELECT * FROM jobs WHERE id = ?').get(id) as Record<string, unknown> | undefined
  return row ? rowToJob(row) : null
}

export interface JobUpdate {
  status?: Job['status']
  type?: 'theme' | 'admin'
  clientId?: string
  round?: number
  unpublishedThemeId?: string
  previewUrl?: string
  planJson?: string
  planHash?: string
  error?: string
  finished?: boolean
}

export function updateJob(db: Database.Database, id: string, update: JobUpdate): void {
  const fields: string[] = []
  const values: unknown[] = []
  const columnByKey: Record<string, string> = {
    status: 'status',
    type: 'type',
    clientId: 'client_id',
    round: 'round',
    unpublishedThemeId: 'unpublished_theme_id',
    previewUrl: 'preview_url',
    planJson: 'plan_json',
    planHash: 'plan_hash',
    error: 'error',
  }
  for (const [key, column] of Object.entries(columnByKey)) {
    const value = (update as Record<string, unknown>)[key]
    if (value !== undefined) {
      fields.push(`${column} = ?`)
      values.push(value)
    }
  }
  if (update.finished) {
    fields.push(`finished_at = datetime('now')`)
  }
  if (fields.length === 0) return
  db.prepare(`UPDATE jobs SET ${fields.join(', ')} WHERE id = ?`).run(...values, id)
}

export interface TaskState {
  clickupTaskId: string
  clientId: string
  type: 'theme' | 'admin' | null
  unpublishedThemeId: string | null
  branch: string | null
  round: number
  status: string | null
  approvedPlanHash: string | null
  lastCommentId: string | null
}

function rowToTaskState(row: Record<string, unknown>): TaskState {
  return {
    clickupTaskId: row.clickup_task_id as string,
    clientId: row.client_id as string,
    type: row.type as TaskState['type'],
    unpublishedThemeId: row.unpublished_theme_id as string | null,
    branch: row.branch as string | null,
    round: row.round as number,
    status: row.status as string | null,
    approvedPlanHash: row.approved_plan_hash as string | null,
    lastCommentId: row.last_comment_id as string | null,
  }
}

export function getTaskState(db: Database.Database, taskId: string): TaskState | null {
  const row = db.prepare('SELECT * FROM task_state WHERE clickup_task_id = ?').get(taskId) as
    | Record<string, unknown>
    | undefined
  return row ? rowToTaskState(row) : null
}

export function upsertTaskState(db: Database.Database, state: Partial<TaskState> & { clickupTaskId: string }): void {
  const existing = getTaskState(db, state.clickupTaskId)
  const merged: TaskState = {
    clickupTaskId: state.clickupTaskId,
    clientId: state.clientId ?? existing?.clientId ?? '',
    type: state.type ?? existing?.type ?? null,
    unpublishedThemeId: state.unpublishedThemeId ?? existing?.unpublishedThemeId ?? null,
    branch: state.branch ?? existing?.branch ?? null,
    round: state.round ?? existing?.round ?? 0,
    status: state.status ?? existing?.status ?? null,
    approvedPlanHash: state.approvedPlanHash ?? existing?.approvedPlanHash ?? null,
    lastCommentId: state.lastCommentId ?? existing?.lastCommentId ?? null,
  }
  db.prepare(
    `INSERT INTO task_state (clickup_task_id, client_id, type, unpublished_theme_id, branch, round, status, approved_plan_hash, last_comment_id)
     VALUES (@clickupTaskId, @clientId, @type, @unpublishedThemeId, @branch, @round, @status, @approvedPlanHash, @lastCommentId)
     ON CONFLICT(clickup_task_id) DO UPDATE SET
       client_id = excluded.client_id, type = excluded.type, unpublished_theme_id = excluded.unpublished_theme_id,
       branch = excluded.branch, round = excluded.round, status = excluded.status,
       approved_plan_hash = excluded.approved_plan_hash, last_comment_id = excluded.last_comment_id`,
  ).run(merged)
}

export function writeAudit(
  db: Database.Database,
  entry: { jobId: string; tool: string; summary: string; ok: boolean; durationMs: number },
): void {
  db.prepare('INSERT INTO audit (job_id, tool, summary, ok, duration_ms) VALUES (?, ?, ?, ?, ?)').run(
    entry.jobId,
    entry.tool,
    entry.summary,
    entry.ok ? 1 : 0,
    entry.durationMs,
  )
}

export function listRecentJobs(db: Database.Database, limit = 50): Job[] {
  const rows = db.prepare('SELECT * FROM jobs ORDER BY created_at DESC LIMIT ?').all(limit) as Record<string, unknown>[]
  return rows.map(rowToJob)
}

export function listAuditForJob(db: Database.Database, jobId: string) {
  return db.prepare('SELECT * FROM audit WHERE job_id = ? ORDER BY at ASC').all(jobId) as Array<{
    id: number
    job_id: string
    tool: string
    summary: string
    ok: number
    duration_ms: number
    at: string
  }>
}

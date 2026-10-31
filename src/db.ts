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
}

export function enqueueJob(db: Database.Database, input: JobInput): void {
  db.prepare(
    `INSERT INTO jobs (id, clickup_task_id, kind, status) VALUES (?, ?, ?, 'queued')`,
  ).run(input.id, input.clickupTaskId, input.kind)
}

export function queueDepth(db: Database.Database): number {
  const row = db.prepare(`SELECT COUNT(*) as n FROM jobs WHERE status = 'queued'`).get() as { n: number }
  return row.n
}

export function lastJobAt(db: Database.Database): string | null {
  const row = db.prepare(`SELECT MAX(created_at) as at FROM jobs`).get() as { at: string | null }
  return row.at
}

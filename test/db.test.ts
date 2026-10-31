import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { migrate, recordWebhookEvent } from '../src/db.js'

describe('webhook dedupe', () => {
  let db: Database.Database

  beforeEach(() => {
    db = new Database(':memory:')
    migrate(db)
  })

  it('records a new history item id as new', () => {
    const isNew = recordWebhookEvent(db, {
      historyItemId: 'hist_1',
      event: 'taskStatusUpdated',
      taskId: 'task_1',
    })
    expect(isNew).toBe(true)
  })

  it('treats a repeated history item id as a duplicate', () => {
    recordWebhookEvent(db, { historyItemId: 'hist_1', event: 'taskStatusUpdated', taskId: 'task_1' })
    const isNew = recordWebhookEvent(db, {
      historyItemId: 'hist_1',
      event: 'taskStatusUpdated',
      taskId: 'task_1',
    })
    expect(isNew).toBe(false)
  })
})

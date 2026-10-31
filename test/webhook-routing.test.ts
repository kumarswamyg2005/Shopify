import { describe, it, expect } from 'vitest'
import { routeEvent, type ClickUpWebhookEvent } from '../src/webhooks/clickup.js'

function statusEvent(after: string): ClickUpWebhookEvent {
  return {
    event: 'taskStatusUpdated',
    webhook_id: 'wh_1',
    task_id: 'task_1',
    history_items: [{ id: 'hist_1', field: 'status', after: { status: after } }],
  }
}

function commentEvent(text: string): ClickUpWebhookEvent {
  return {
    event: 'taskCommentPosted',
    webhook_id: 'wh_1',
    task_id: 'task_1',
    history_items: [{ id: 'hist_2', field: 'comment', comment: { text_content: text } }],
  }
}

describe('routeEvent — status mapping', () => {
  it.each([
    ['agent queue', 'enqueue_initial'],
    ['approved', 'enqueue_approved'],
    ['agent working', 'ignore'],
    ['review', 'ignore'],
    ['live', 'ignore'],
    ['blocked', 'ignore'],
  ] as const)('status %s -> %s', (after, expected) => {
    const decision = routeEvent(statusEvent(after), { knownWebhook: true })
    expect(decision.action).toBe(expected)
  })
})

describe('routeEvent — comments', () => {
  it('a plain comment while task is in review enqueues a revision', () => {
    const decision = routeEvent(commentEvent('please make it sticky on mobile'), {
      knownWebhook: true,
      currentStatus: 'review',
    })
    expect(decision.action).toBe('enqueue_revision')
  })

  it('a comment outside review is ignored', () => {
    const decision = routeEvent(commentEvent('looks good'), {
      knownWebhook: true,
      currentStatus: 'agent working',
    })
    expect(decision.action).toBe('ignore')
  })

  it('a [StoreLoop] comment never triggers a job, even in review', () => {
    const decision = routeEvent(commentEvent('[StoreLoop] round 2 ready for review'), {
      knownWebhook: true,
      currentStatus: 'review',
    })
    expect(decision.action).toBe('ignore')
  })
})

describe('routeEvent — unknown webhook/list', () => {
  it('is ignored regardless of event content', () => {
    const decision = routeEvent(statusEvent('agent queue'), { knownWebhook: false })
    expect(decision.action).toBe('ignore')
  })
})

describe('routeEvent — unhandled event types', () => {
  it('is ignored', () => {
    const decision = routeEvent(
      { event: 'taskCreated', webhook_id: 'wh_1', task_id: 'task_1', history_items: [] },
      { knownWebhook: true },
    )
    expect(decision.action).toBe('ignore')
  })
})

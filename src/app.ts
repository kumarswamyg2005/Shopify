import { Hono } from 'hono'
import { basicAuth } from 'hono/basic-auth'
import { randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'
import { z } from 'zod'
import { clickUpWebhookEventSchema, routeEvent, verifySignature } from './webhooks/clickup.js'
import { recordWebhookEvent, enqueueJob, queueDepth, lastJobAt } from './db.js'

export interface AppDeps {
  db: Database.Database
  getWebhookSecret: () => string
  resolveWebhook: (webhookId: string) => { clientId: string } | undefined
  getCurrentStatus: (taskId: string) => string | undefined
  adminAuth: { user: string; pass: string }
  registerWebhook: (input: { clientId: string; endpointUrl: string }) => Promise<{ webhookId: string }>
}

function jobKindForApproval(db: Database.Database, taskId: string): 'publish' | 'execute' {
  const row = db.prepare('SELECT type FROM task_state WHERE clickup_task_id = ?').get(taskId) as
    | { type: 'theme' | 'admin' | null }
    | undefined
  // ponytail: task_state isn't populated until the initial-job step writes it (later build step);
  // default to 'publish' until then rather than adding a lookup path that can't be hit yet.
  return row?.type === 'admin' ? 'execute' : 'publish'
}

export function createApp(deps: AppDeps) {
  const app = new Hono()

  app.get('/health', (c) => {
    return c.json({
      ok: true,
      queueDepth: queueDepth(deps.db),
      lastJobAt: lastJobAt(deps.db),
    })
  })

  app.post('/webhooks/clickup', async (c) => {
    const rawBody = await c.req.text()
    const signature = c.req.header('x-signature')
    if (!verifySignature(rawBody, signature, deps.getWebhookSecret())) {
      return c.json({ error: 'invalid signature' }, 401)
    }

    const parsed = clickUpWebhookEventSchema.safeParse(JSON.parse(rawBody))
    if (!parsed.success) {
      return c.json({ error: 'invalid payload' }, 400)
    }
    const event = parsed.data

    let anyNew = false
    for (const item of event.history_items) {
      if (recordWebhookEvent(deps.db, { historyItemId: item.id, event: event.event, taskId: event.task_id })) {
        anyNew = true
      }
    }
    if (!anyNew) {
      return c.json({ action: 'ignore', reason: 'duplicate history item' })
    }

    const knownWebhook = deps.resolveWebhook(event.webhook_id) !== undefined
    const currentStatus = deps.getCurrentStatus(event.task_id)
    const decision = routeEvent(event, { knownWebhook, currentStatus })

    if (decision.action === 'ignore') {
      return c.json({ action: decision.action, reason: decision.reason })
    }

    const kind =
      decision.action === 'enqueue_initial'
        ? 'initial'
        : decision.action === 'enqueue_revision'
          ? 'revision'
          : jobKindForApproval(deps.db, event.task_id)

    enqueueJob(deps.db, { id: randomUUID(), clickupTaskId: event.task_id, kind })
    return c.json({ action: decision.action })
  })

  const registerWebhookBody = z.object({ clientId: z.string(), endpointUrl: z.string().url() })

  app.post(
    '/admin/register-webhook',
    basicAuth({ username: deps.adminAuth.user, password: deps.adminAuth.pass }),
    async (c) => {
      const parsed = registerWebhookBody.safeParse(await c.req.json())
      if (!parsed.success) return c.json({ error: 'invalid body' }, 400)
      try {
        const { webhookId } = await deps.registerWebhook(parsed.data)
        return c.json({ ok: true, webhookId })
      } catch (err) {
        return c.json({ ok: false, error: (err as Error).message }, 500)
      }
    },
  )

  return app
}

import { Hono } from 'hono'
import { basicAuth } from 'hono/basic-auth'
import { randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'
import { z } from 'zod'
import { clickUpWebhookEventSchema, routeEvent, verifySignature } from './webhooks/clickup.js'
import { recordWebhookEvent, enqueueJob, queueDepth, lastJobAt, getTaskState } from './db.js'

export interface AppDeps {
  db: Database.Database
  getWebhookSecret: () => string
  resolveWebhook: (webhookId: string) => { clientId: string } | undefined
  getCurrentStatus: (taskId: string) => string | undefined
  adminAuth: { user: string; pass: string }
  registerWebhook: (input: { clientId: string; endpointUrl: string }) => Promise<{ webhookId: string }>
}

function jobKindForApproval(db: Database.Database, taskId: string): 'publish' | 'execute' {
  const state = getTaskState(db, taskId)
  return state?.type === 'admin' ? 'execute' : 'publish'
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

    const webhook = deps.resolveWebhook(event.webhook_id)
    const currentStatus = deps.getCurrentStatus(event.task_id)
    const decision = routeEvent(event, { knownWebhook: webhook !== undefined, currentStatus })

    if (decision.action === 'ignore') {
      return c.json({ action: decision.action, reason: decision.reason })
    }

    const kind =
      decision.action === 'enqueue_initial'
        ? 'initial'
        : decision.action === 'enqueue_revision'
          ? 'revision'
          : jobKindForApproval(deps.db, event.task_id)

    // Snapshot the plan hash the human is approving right now (invariant 2): if a revision runs
    // after this but before the publish/execute job executes, the snapshot and task_state's
    // current hash will disagree and src/shopify/publish.ts will refuse to publish the stale one.
    const planHash = decision.action === 'enqueue_approved' ? (getTaskState(deps.db, event.task_id)?.approvedPlanHash ?? undefined) : undefined

    enqueueJob(deps.db, {
      id: randomUUID(),
      clickupTaskId: event.task_id,
      kind,
      clientId: webhook?.clientId,
      planHash,
    })
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

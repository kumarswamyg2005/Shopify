import { serve } from '@hono/node-server'
import { env } from './env.js'
import { logger } from './logger.js'
import { openDb } from './db.js'
import { createApp } from './app.js'
import { readWebhookSecret, readWebhookRegistrations, unregisteredSecretFallback } from './webhooks/secret.js'

const db = openDb('data/storeloop.db')

const webhookSecret = readWebhookSecret() ?? unregisteredSecretFallback()
if (!readWebhookSecret()) {
  logger.warn('no webhook secret registered yet — run `npm run register-webhook`; all webhooks will be rejected')
}

function resolveWebhook(webhookId: string): { clientId: string } | undefined {
  const reg = readWebhookRegistrations().find((r) => r.webhookId === webhookId)
  return reg ? { clientId: reg.clientId } : undefined
}

// ponytail: task_state doesn't track live ClickUp status yet (lands with the ClickUp client in
// a later step); until then, comments never match "review" and revisions are never enqueued.
function getCurrentStatus(_taskId: string): string | undefined {
  return undefined
}

const app = createApp({ db, webhookSecret, resolveWebhook, getCurrentStatus })

serve({ fetch: app.fetch, port: env.PORT }, (info) => {
  logger.info({ port: info.port }, 'StoreLoop listening')
})

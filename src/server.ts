import { serve } from '@hono/node-server'
import { env } from './env.js'
import { logger } from './logger.js'
import { openDb } from './db.js'
import { createApp } from './app.js'
import {
  readWebhookSecret,
  writeWebhookSecret,
  readWebhookRegistrations,
  writeWebhookRegistration,
  unregisteredSecretFallback,
} from './webhooks/secret.js'
import { ClickUpClient } from './clickup/client.js'
import { loadClientConfig } from './clients/config.js'

const db = openDb('data/storeloop.db')
const clickUp = new ClickUpClient({ apiToken: env.CLICKUP_API_TOKEN, teamId: env.CLICKUP_WORKSPACE_ID })

if (!readWebhookSecret()) {
  logger.warn('no webhook secret registered yet — call POST /admin/register-webhook; all webhooks will be rejected until then')
}

function resolveWebhook(webhookId: string): { clientId: string } | undefined {
  const reg = readWebhookRegistrations().find((r) => r.webhookId === webhookId)
  return reg ? { clientId: reg.clientId } : undefined
}

// ponytail: task_state doesn't track live ClickUp status yet (lands with the job-processing
// worker in a later build step); until then, comments never match "review" and revisions are
// never enqueued.
function getCurrentStatus(_taskId: string): string | undefined {
  return undefined
}

async function registerWebhook(input: { clientId: string; endpointUrl: string }): Promise<{ webhookId: string }> {
  const client = loadClientConfig(`clients/${input.clientId}.yaml`)
  const created = await clickUp.createWebhook(client.clickupSpaceId, input.endpointUrl)
  writeWebhookSecret(created.secret)
  writeWebhookRegistration({ webhookId: created.id, clientId: input.clientId })
  return { webhookId: created.id }
}

const app = createApp({
  db,
  getWebhookSecret: () => readWebhookSecret() ?? unregisteredSecretFallback(),
  resolveWebhook,
  getCurrentStatus,
  adminAuth: { user: env.RUNS_BASIC_AUTH_USER, pass: env.RUNS_BASIC_AUTH_PASS },
  registerWebhook,
})

serve({ fetch: app.fetch, port: env.PORT }, (info) => {
  logger.info({ port: info.port }, 'StoreLoop listening')
})

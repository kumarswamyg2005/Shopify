import { describe, it, expect, beforeEach } from 'vitest'
import { createHmac } from 'node:crypto'
import Database from 'better-sqlite3'
import { createApp, type AppDeps } from '../src/app.js'
import { migrate } from '../src/db.js'

const SECRET = 'test-webhook-secret'

function testDeps(overrides: Partial<AppDeps> = {}): AppDeps {
  const db = new Database(':memory:')
  migrate(db)
  return {
    db,
    getWebhookSecret: () => SECRET,
    resolveWebhook: (webhookId) => (webhookId === 'wh_1' ? { clientId: 'storeloop-demo' } : undefined),
    getCurrentStatus: () => undefined,
    adminAuth: { user: 'admin', pass: 'admin-pass' },
    registerWebhook: async () => ({ webhookId: 'wh_new' }),
    ...overrides,
  }
}

function sign(body: string): string {
  return createHmac('sha256', SECRET).update(body).digest('hex')
}

function statusPayload(after: string, webhookId = 'wh_1', historyId = 'hist_1') {
  return JSON.stringify({
    event: 'taskStatusUpdated',
    webhook_id: webhookId,
    task_id: 'task_1',
    history_items: [{ id: historyId, field: 'status', after: { status: after } }],
  })
}

function commentPayload(text: string, webhookId = 'wh_1', historyId = 'hist_2') {
  return JSON.stringify({
    event: 'taskCommentPosted',
    webhook_id: webhookId,
    task_id: 'task_1',
    history_items: [{ id: historyId, field: 'comment', comment: { text_content: text } }],
  })
}

describe('POST /webhooks/clickup', () => {
  let app: ReturnType<typeof createApp>
  let currentStatus: string | undefined

  beforeEach(() => {
    currentStatus = undefined
    app = createApp(testDeps({ getCurrentStatus: () => currentStatus }))
  })

  it('accepts a valid signature and enqueues a job', async () => {
    const body = statusPayload('agent queue')
    const res = await app.request('/webhooks/clickup', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-signature': sign(body) },
      body,
    })
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.action).toBe('enqueue_initial')
  })

  it('rejects a tampered body with 401 and creates no job', async () => {
    const body = statusPayload('agent queue')
    const tamperedBody = statusPayload('agent queue', 'wh_1', 'hist_1_tampered')
    const res = await app.request('/webhooks/clickup', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-signature': sign(body) },
      body: tamperedBody,
    })
    expect(res.status).toBe(401)
  })

  it('rejects a request with no signature header with 401', async () => {
    const res = await app.request('/webhooks/clickup', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: statusPayload('agent queue'),
    })
    expect(res.status).toBe(401)
  })

  it('ignores a duplicate history_items id', async () => {
    const body = statusPayload('agent queue')
    const first = await app.request('/webhooks/clickup', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-signature': sign(body) },
      body,
    })
    expect(first.status).toBe(200)
    const second = await app.request('/webhooks/clickup', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-signature': sign(body) },
      body,
    })
    expect(second.status).toBe(200)
    const secondJson = await second.json()
    expect(secondJson.action).toBe('ignore')
  })

  it('ignores a [StoreLoop] comment even while the task is in review', async () => {
    currentStatus = 'review'
    const body = commentPayload('[StoreLoop] round 2 ready for review')
    const res = await app.request('/webhooks/clickup', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-signature': sign(body) },
      body,
    })
    const json = await res.json()
    expect(json.action).toBe('ignore')
  })

  it('ignores an unknown webhook id (unrecognized list)', async () => {
    const body = statusPayload('agent queue', 'wh_unknown')
    const res = await app.request('/webhooks/clickup', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-signature': sign(body) },
      body,
    })
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.action).toBe('ignore')
  })
})

describe('GET /health', () => {
  it('reports ok and queue depth', async () => {
    const app = createApp(testDeps())
    const res = await app.request('/health')
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.ok).toBe(true)
    expect(json.queueDepth).toBe(0)
  })
})

describe('POST /admin/register-webhook', () => {
  it('rejects a request with no basic auth credentials', async () => {
    const app = createApp(testDeps())
    const res = await app.request('/admin/register-webhook', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ clientId: 'storeloop-demo', endpointUrl: 'https://example.com/webhooks/clickup' }),
    })
    expect(res.status).toBe(401)
  })

  it('registers a webhook with valid credentials and returns the webhook id, never the secret', async () => {
    const app = createApp(testDeps())
    const basic = Buffer.from('admin:admin-pass').toString('base64')
    const res = await app.request('/admin/register-webhook', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Basic ${basic}` },
      body: JSON.stringify({ clientId: 'storeloop-demo', endpointUrl: 'https://example.com/webhooks/clickup' }),
    })
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.ok).toBe(true)
    expect(json.webhookId).toBe('wh_new')
    expect(JSON.stringify(json)).not.toContain('secret')
  })
})

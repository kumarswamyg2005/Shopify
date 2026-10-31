import { describe, it, expect } from 'vitest'
import { createApp, type AppDeps } from '../src/app.js'
import Database from 'better-sqlite3'
import { migrate, enqueueJob } from '../src/db.js'

function testDeps(): AppDeps {
  const db = new Database(':memory:')
  migrate(db)
  return {
    db,
    getWebhookSecret: () => 'secret',
    resolveWebhook: () => undefined,
    getCurrentStatus: () => undefined,
    adminAuth: { user: 'admin', pass: 'pass' },
    registerWebhook: async () => ({ webhookId: 'wh' }),
  }
}

const basicAuthHeader = (user: string, pass: string) => `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`

describe('GET /runs', () => {
  it('requires basic auth', async () => {
    const app = createApp(testDeps())
    const res = await app.request('/runs')
    expect(res.status).toBe(401)
  })

  it('renders the ledger with an empty state when there are no jobs', async () => {
    const app = createApp(testDeps())
    const res = await app.request('/runs', { headers: { authorization: basicAuthHeader('admin', 'pass') } })
    expect(res.status).toBe(200)
    const html = await res.text()
    expect(html).toContain('No jobs yet')
  })

  it('lists a job by task id', async () => {
    const deps = testDeps()
    enqueueJob(deps.db, { id: 'job-1', clickupTaskId: 'task_42', kind: 'initial', clientId: 'storeloop-demo' })
    const app = createApp(deps)
    const res = await app.request('/runs', { headers: { authorization: basicAuthHeader('admin', 'pass') } })
    const html = await res.text()
    expect(html).toContain('task_42')
    expect(html).toContain('/runs/job-1')
  })
})

describe('GET /runs/:jobId', () => {
  it('requires basic auth', async () => {
    const deps = testDeps()
    enqueueJob(deps.db, { id: 'job-1', clickupTaskId: 'task_42', kind: 'initial' })
    const app = createApp(deps)
    const res = await app.request('/runs/job-1')
    expect(res.status).toBe(401)
  })

  it('404s for an unknown job', async () => {
    const app = createApp(testDeps())
    const res = await app.request('/runs/nope', { headers: { authorization: basicAuthHeader('admin', 'pass') } })
    expect(res.status).toBe(404)
  })

  it('renders job detail', async () => {
    const deps = testDeps()
    enqueueJob(deps.db, { id: 'job-1', clickupTaskId: 'task_42', kind: 'initial' })
    const app = createApp(deps)
    const res = await app.request('/runs/job-1', { headers: { authorization: basicAuthHeader('admin', 'pass') } })
    expect(res.status).toBe(200)
    const html = await res.text()
    expect(html).toContain('task_42')
  })
})

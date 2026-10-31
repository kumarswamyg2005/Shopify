import { describe, it, expect, afterEach, vi } from 'vitest'
import { existsSync, rmSync, readFileSync } from 'node:fs'
import { executeApprovedAdminPlan } from '../src/shopify/admin-execute.js'
import { PlanHashMismatchError } from '../src/shopify/publish.js'

const taskId = 'test-admin-execute-task'
const rollbackPath = `runs/${taskId}/rollback.json`

const taskState = {
  clickupTaskId: taskId,
  clientId: 'storeloop-demo',
  type: 'admin' as const,
  unpublishedThemeId: null,
  branch: null,
  round: 1,
  status: 'approved',
  approvedPlanHash: 'hash-a',
  lastCommentId: null,
}

function makeClient() {
  return {
    tagsAdd: vi.fn().mockResolvedValue(undefined),
    tagsRemove: vi.fn().mockResolvedValue(undefined),
    collectionCreateFromTag: vi.fn().mockResolvedValue({ id: 'gid://shopify/Collection/1' }),
    urlRedirectCreate: vi.fn().mockResolvedValue({ id: 'gid://shopify/UrlRedirect/1' }),
    metafieldsSet: vi.fn().mockResolvedValue(undefined),
  } as unknown as import('../src/shopify/admin.js').ShopifyAdminClient
}

afterEach(() => {
  if (existsSync(`runs/${taskId}`)) rmSync(`runs/${taskId}`, { recursive: true })
})

describe('executeApprovedAdminPlan', () => {
  it('refuses on a stale plan hash', async () => {
    const client = makeClient()
    const plan = { mutations: [], affectedCount: 0, sample: [], risks: [] }
    await expect(executeApprovedAdminPlan(client, taskState, plan, 'stale-hash', taskId)).rejects.toThrow(
      PlanHashMismatchError,
    )
  })

  it('refuses a non-allow-listed mutation op', async () => {
    const client = makeClient()
    const plan = {
      mutations: [{ op: 'productDelete' as never, target: 'gid://shopify/Product/1', input: {} }],
      affectedCount: 1,
      sample: [],
      risks: [],
    }
    await expect(executeApprovedAdminPlan(client, taskState, plan, 'hash-a', taskId)).rejects.toThrow(/allow-listed/)
  })

  it('executes allow-listed mutations and writes a replayable rollback.json', async () => {
    const client = makeClient()
    const plan = {
      mutations: [
        { op: 'tagsAdd' as const, target: 'gid://shopify/Product/1', input: { tags: ['Holiday Gift'] } },
        { op: 'collectionCreate' as const, target: 'Holiday Gifts', input: { tag: 'Holiday Gift' } },
      ],
      affectedCount: 2,
      sample: ['gid://shopify/Product/1'],
      risks: [],
    }
    const result = await executeApprovedAdminPlan(client, taskState, plan, 'hash-a', taskId)
    expect(result.executedCount).toBe(2)
    expect(client.tagsAdd).toHaveBeenCalledWith('gid://shopify/Product/1', ['Holiday Gift'])
    expect(client.collectionCreateFromTag).toHaveBeenCalledWith('Holiday Gifts', 'Holiday Gift')

    expect(existsSync(rollbackPath)).toBe(true)
    const rollback = JSON.parse(readFileSync(rollbackPath, 'utf8'))
    expect(rollback.taskId).toBe(taskId)
    expect(rollback.mutations).toHaveLength(2)
    expect(rollback.mutations[0].rollbackHint).toContain('tagsRemove')
  })
})

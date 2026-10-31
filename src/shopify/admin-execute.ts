import { writeFileSync, mkdirSync } from 'node:fs'
import { isAdminMutationAllowed } from '../policy.js'
import type { ShopifyAdminClient } from './admin.js'
import type { AdminAgentResult } from '../agent/admin-agent.js'
import type { TaskState } from '../db.js'
import { PlanHashMismatchError } from './publish.js'

export interface ExecuteResult {
  executedCount: number
  rollbackPath: string
}

function rollbackHint(mutation: AdminAgentResult['mutations'][number]): string {
  switch (mutation.op) {
    case 'tagsAdd':
      return `tagsRemove on ${mutation.target} with the same tags`
    case 'tagsRemove':
      return `tagsAdd on ${mutation.target} with the same tags`
    case 'collectionCreate':
      return `delete the created collection by hand (out of scope for automatic rollback)`
    case 'urlRedirectCreate':
      return `delete the created redirect by hand (out of scope for automatic rollback)`
    case 'metafieldsSet':
      return `metafieldsSet back to the previous value, if known`
  }
}

/**
 * Executes an approved admin plan's mutations (invariant 1, 2, 7, 8): refuses on a stale plan
 * hash, refuses any mutation not on the fixed allow-list, and writes runs/<taskId>/rollback.json
 * before anything is reported done.
 */
export async function executeApprovedAdminPlan(
  client: ShopifyAdminClient,
  taskState: TaskState,
  plan: AdminAgentResult,
  jobPlanHash: string | null,
  taskId: string,
): Promise<ExecuteResult> {
  if (jobPlanHash === null || jobPlanHash !== taskState.approvedPlanHash) {
    throw new PlanHashMismatchError()
  }

  const results: Array<{ mutation: AdminAgentResult['mutations'][number]; ok: boolean; rollbackHint: string }> = []

  for (const mutation of plan.mutations) {
    if (!isAdminMutationAllowed(mutation.op)) {
      throw new Error(`refusing non-allow-listed mutation: ${mutation.op}`)
    }
    switch (mutation.op) {
      case 'tagsAdd':
        await client.tagsAdd(mutation.target, (mutation.input.tags as string[]) ?? [])
        break
      case 'tagsRemove':
        await client.tagsRemove(mutation.target, (mutation.input.tags as string[]) ?? [])
        break
      case 'collectionCreate':
        await client.collectionCreateFromTag(mutation.target, (mutation.input.tag as string) ?? '')
        break
      case 'urlRedirectCreate':
        await client.urlRedirectCreate(mutation.target, (mutation.input.destination as string) ?? '')
        break
      case 'metafieldsSet':
        await client.metafieldsSet({
          ownerId: mutation.target,
          namespace: mutation.input.namespace as string,
          key: mutation.input.key as string,
          type: mutation.input.type as string,
          value: mutation.input.value as string,
        })
        break
    }
    results.push({ mutation, ok: true, rollbackHint: rollbackHint(mutation) })
  }

  const rollbackDir = `runs/${taskId}`
  mkdirSync(rollbackDir, { recursive: true })
  const rollbackPath = `${rollbackDir}/rollback.json`
  writeFileSync(
    rollbackPath,
    JSON.stringify({ taskId, executedAt: new Date().toISOString(), mutations: results }, null, 2),
  )

  return { executedCount: results.length, rollbackPath }
}

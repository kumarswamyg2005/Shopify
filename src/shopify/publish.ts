import { getLiveThemeId, publishTheme, type ShopifyCliConfig } from './theme.js'
import type { TaskState } from '../db.js'

export class PlanHashMismatchError extends Error {
  constructor() {
    super('approved plan hash does not match the current plan — ask the human to re-approve the latest round')
  }
}

export interface PublishResult {
  publishedThemeId: string
  previousLiveThemeId: string | null
}

/**
 * The only place a theme actually goes live (invariant 2). Refuses unless the plan hash
 * captured when this publish job was enqueued still matches the task's current approved plan
 * hash — if a revision ran after approval was requested, this throws instead of publishing a
 * stale version.
 */
export async function publishApprovedTheme(
  config: ShopifyCliConfig,
  taskState: TaskState,
  jobPlanHash: string | null,
): Promise<PublishResult> {
  if (!taskState.unpublishedThemeId) {
    throw new Error('no unpublished theme recorded for this task')
  }
  if (jobPlanHash === null || jobPlanHash !== taskState.approvedPlanHash) {
    throw new PlanHashMismatchError()
  }
  const previousLiveThemeId = await getLiveThemeId(config)
  await publishTheme(config, taskState.unpublishedThemeId)
  return { publishedThemeId: taskState.unpublishedThemeId, previousLiveThemeId }
}

import type { PlatformAdapter, Plan, Preview, ApplyResult, Task } from './types.js'
import type { ClientConfig } from '../clients/config.js'
import { ensureWorkspace, checkoutTaskBranch, diffSummary, commitWorkspace } from '../shopify/workspace.js'
import { pushUnpublished, type ShopifyCliConfig } from '../shopify/theme.js'
import { publishApprovedTheme } from '../shopify/publish.js'
import { runThemeAgent } from '../agent/theme-agent.js'
import { computePlanHash } from '../policy.js'
import type { TaskState } from '../db.js'

/**
 * Shopify's native "preview concept" is an unpublished theme with a preview_theme_id URL.
 * `src/worker/process-job.ts` currently calls the underlying modules directly rather than
 * through this adapter (revisions, screenshots, and ClickUp posting need per-round state this
 * interface doesn't carry) — this class is the documented extensibility seam other platforms
 * implement against, exercised here for the one platform StoreLoop actually ships with.
 */
export class ShopifyThemeAdapter implements PlatformAdapter {
  readonly id = 'shopify-theme'

  constructor(
    private readonly client: ClientConfig,
    private readonly cliConfig: ShopifyCliConfig,
    private readonly model: string,
  ) {}

  async plan(task: Task): Promise<Plan> {
    await ensureWorkspace(this.client.themeRepoPath, this.cliConfig)
    await checkoutTaskBranch(this.client.themeRepoPath, task.id)
    const result = await runThemeAgent({
      taskTitle: task.title,
      taskDescription: task.description,
      priorComments: [],
      brandFilePath: this.client.brandFilePath,
      workspaceDir: this.client.themeRepoPath,
      model: this.model,
    })
    const diff = await diffSummary(this.client.themeRepoPath)
    await commitWorkspace(this.client.themeRepoPath, `storeloop: ${task.id}`)
    return { summary: result.summary, filesChanged: diff.filesChanged, assumptions: result.assumptions, questionsForHuman: result.questionsForHuman }
  }

  async preview(plan: Plan): Promise<Preview> {
    const pushed = await pushUnpublished(this.cliConfig, this.client.themeRepoPath, `SL-${plan.filesChanged}`)
    return { url: pushed.previewUrl, artifacts: [] }
  }

  /** Delegates to src/shopify/publish.ts — the only place a theme actually goes live (invariant 2). */
  async apply(plan: Plan, approval: { approvedPlanHash: string }): Promise<ApplyResult> {
    const taskState: TaskState = {
      clickupTaskId: '',
      clientId: this.client.id,
      type: 'theme',
      unpublishedThemeId: (plan.unpublishedThemeId as string) ?? null,
      branch: null,
      round: 1,
      status: 'approved',
      approvedPlanHash: approval.approvedPlanHash,
      lastCommentId: null,
    }
    const result = await publishApprovedTheme(this.cliConfig, taskState, computePlanHash(plan))
    return { ...result }
  }

  async rollback(applyResult: ApplyResult): Promise<void> {
    throw new Error(
      `rollback is a manual republish of the previous live theme (${applyResult.previousLiveThemeId}) via the Shopify admin for this PoC`,
    )
  }
}

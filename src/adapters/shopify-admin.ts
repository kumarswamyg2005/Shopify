import type { PlatformAdapter, Plan, Preview, ApplyResult, Task } from './types.js'
import { ShopifyAdminClient } from '../shopify/admin.js'
import { executeApprovedAdminPlan } from '../shopify/admin-execute.js'
import { runAdminAgent, adminAgentResultSchema, type AdminAgentResult } from '../agent/admin-agent.js'
import { computePlanHash } from '../policy.js'
import type { TaskState } from '../db.js'

/**
 * Shopify admin changes have no visual "preview" — the plan itself (mutation list, affected
 * count, sample) is the preview, shown as a dry-run before anything executes.
 */
export class ShopifyAdminAdapter implements PlatformAdapter {
  readonly id = 'shopify-admin'

  constructor(
    private readonly clientId: string,
    private readonly adminClient: ShopifyAdminClient,
    private readonly model: string,
  ) {}

  async plan(task: Task): Promise<Plan> {
    const result = await runAdminAgent({
      taskTitle: task.title,
      taskDescription: task.description,
      priorComments: [],
      runsDir: `runs/${task.id}`,
      model: this.model,
      adminClient: this.adminClient,
    })
    return { summary: `${result.mutations.length} mutation(s) planned`, ...result }
  }

  async preview(plan: Plan): Promise<Preview> {
    return { url: '', artifacts: [{ kind: 'file', path: JSON.stringify(plan) }] }
  }

  async apply(plan: Plan, approval: { approvedPlanHash: string }): Promise<ApplyResult> {
    const taskState: TaskState = {
      clickupTaskId: '',
      clientId: this.clientId,
      type: 'admin',
      unpublishedThemeId: null,
      branch: null,
      round: 1,
      status: 'approved',
      approvedPlanHash: approval.approvedPlanHash,
      lastCommentId: null,
    }
    const parsedPlan: AdminAgentResult = adminAgentResultSchema.parse(plan)
    const result = await executeApprovedAdminPlan(this.adminClient, taskState, parsedPlan, computePlanHash(plan), 'adapter-call')
    return { ...result }
  }

  async rollback(applyResult: ApplyResult): Promise<void> {
    throw new Error(`see ${applyResult.rollbackPath} — rollback is applied by hand for this PoC, not automatically re-executed`)
  }
}

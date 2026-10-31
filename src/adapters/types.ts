export interface Plan {
  summary: string
  [key: string]: unknown
}

export interface Artifact {
  kind: 'screenshot' | 'file'
  path: string
}

export interface Preview {
  url: string
  artifacts: Artifact[]
}

export interface ApplyResult {
  [key: string]: unknown
}

export interface Task {
  id: string
  title: string
  description: string
}

/**
 * The platform-agnostic shape of the StoreLoop loop: an agent produces a Plan (a dry-run or a
 * working copy nobody can see yet), the orchestrator turns that into a Preview a human can look
 * at, and only the orchestrator ever calls apply() — after a human approves — or rollback().
 */
export interface PlatformAdapter {
  id: string
  plan(task: Task): Promise<Plan>
  preview(plan: Plan): Promise<Preview>
  apply(plan: Plan, approval: { approvedPlanHash: string }): Promise<ApplyResult>
  rollback(applyResult: ApplyResult): Promise<void>
}

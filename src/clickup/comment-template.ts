function formatDuration(ms: number): string {
  const totalSeconds = Math.round(ms / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}m ${seconds.toString().padStart(2, '0')}s`
}

function listOrNone(items: string[]): string {
  return items.length > 0 ? items.join('; ') : 'none'
}

export interface ThemeReviewCommentInput {
  round: number
  taskTitle: string
  summary: string
  previewThemeId: string
  previewUrl: string
  filesChanged: string[]
  insertions: number
  deletions: number
  themeCheckErrorCount: number
  lighthouseBefore: number
  lighthouseAfter: number
  assumptions: string[]
  questionsForHuman: string[]
  screenshotFilenames: string[]
  agentTimeMs: number
}

export interface AdminPlanCommentInput {
  round: number
  taskTitle: string
  mutationCount: number
  affectedCount: number
  sample: string[]
  risks: string[]
  agentTimeMs: number
}

/** Renders the dry-run admin plan comment posted for review before any mutation executes. */
export function renderAdminPlanComment(input: AdminPlanCommentInput): string {
  return [
    `[StoreLoop] Round ${input.round} ready for review — ${input.taskTitle}`,
    '',
    'Dry-run plan (nothing has been changed yet)',
    `- ${input.mutationCount} mutation(s) planned, affecting ${input.affectedCount} resource(s)`,
    `Sample: ${listOrNone(input.sample)}`,
    `Risks: ${listOrNone(input.risks)}`,
    '',
    'Next: comment to revise the plan · move to "approved" to execute it · nothing runs until then',
    `Agent time: ${formatDuration(input.agentTimeMs)} (logged)`,
  ].join('\n')
}

export function renderQuestionsComment(input: { round: number; taskTitle: string; questions: string[] }): string {
  return [
    `[StoreLoop] Round ${input.round} — need input before I can proceed — ${input.taskTitle}`,
    '',
    'Questions',
    ...input.questions.map((q) => `- ${q}`),
    '',
    'Next: comment with answers to continue',
  ].join('\n')
}

export function renderPublishedComment(input: { previousLiveThemeId: string | null }): string {
  return `[StoreLoop] Live. Previous theme ${input.previousLiveThemeId ?? '(none)'} kept for one-click rollback.`
}

export function renderExecutedComment(input: { executedCount: number; rollbackPath: string }): string {
  return `[StoreLoop] Executed ${input.executedCount} mutation(s). Rollback info written to ${input.rollbackPath}.`
}

export function renderBlockedComment(input: { reason: string }): string {
  return `[StoreLoop] Blocked: ${input.reason}`
}

export function renderPlanStaleComment(): string {
  return '[StoreLoop] The approved plan is no longer the latest — a revision ran after you approved it. Please review the newest round and approve again.'
}

/** Renders the single ClickUp comment posted per round (DESIGN.md PART B template). */
export function renderThemeReviewComment(input: ThemeReviewCommentInput): string {
  const delta = input.lighthouseAfter - input.lighthouseBefore
  const deltaStr = delta === 0 ? '0' : delta > 0 ? `+${delta}` : `${delta}`

  return [
    `[StoreLoop] Round ${input.round} ready for review — ${input.taskTitle}`,
    '',
    'What changed',
    `- ${input.summary}`,
    '',
    `Preview (unpublished theme ${input.previewThemeId}): ${input.previewUrl}`,
    `Files: ${input.filesChanged.length} changed (+${input.insertions} −${input.deletions}) — ${input.filesChanged.join(', ')}`,
    `Checks: theme check ${input.themeCheckErrorCount} errors · Lighthouse mobile ${input.lighthouseBefore} → ${input.lighthouseAfter} (${deltaStr})`,
    `Assumptions: ${listOrNone(input.assumptions)}`,
    `Questions: ${listOrNone(input.questionsForHuman)}`,
    `Screenshots: ${input.screenshotFilenames.join(', ')} (attached)`,
    '',
    'Next: comment to revise · move to "approved" to publish · live theme is untouched until then',
    `Agent time: ${formatDuration(input.agentTimeMs)} (logged)`,
  ].join('\n')
}

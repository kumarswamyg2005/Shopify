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

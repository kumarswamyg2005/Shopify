import { describe, it, expect, vi, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { migrate, enqueueJob, getJob, getTaskState } from '../src/db.js'

const runThemeAgent = vi.fn()
vi.mock('../src/agent/theme-agent.js', () => ({ runThemeAgent: (...a: unknown[]) => runThemeAgent(...a) }))

const ensureWorkspace = vi.fn().mockResolvedValue(undefined)
const checkoutTaskBranch = vi.fn().mockResolvedValue('task/task_1')
const diffSummary = vi.fn()
const commitWorkspace = vi.fn().mockResolvedValue(undefined)
vi.mock('../src/shopify/workspace.js', () => ({
  ensureWorkspace: (...a: unknown[]) => ensureWorkspace(...a),
  checkoutTaskBranch: (...a: unknown[]) => checkoutTaskBranch(...a),
  diffSummary: (...a: unknown[]) => diffSummary(...a),
  commitWorkspace: (...a: unknown[]) => commitWorkspace(...a),
}))

const pushUnpublished = vi.fn()
const pushToExistingTheme = vi.fn()
const getLiveThemeId = vi.fn().mockResolvedValue('OLD-LIVE-1')
const publishTheme = vi.fn().mockResolvedValue(undefined)
vi.mock('../src/shopify/theme.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/shopify/theme.js')>()
  return {
    ...actual,
    pushUnpublished: (...a: unknown[]) => pushUnpublished(...a),
    pushToExistingTheme: (...a: unknown[]) => pushToExistingTheme(...a),
    getLiveThemeId: (...a: unknown[]) => getLiveThemeId(...a),
    publishTheme: (...a: unknown[]) => publishTheme(...a),
  }
})

const captureScreenshots = vi.fn().mockResolvedValue({ desktop: 'runs/x/desktop.png', mobile: 'runs/x/mobile.png' })
vi.mock('../src/verify/screenshots.js', () => ({ captureScreenshots: (...a: unknown[]) => captureScreenshots(...a) }))

const runLighthouse = vi.fn().mockResolvedValue({ performanceScore: 80 })
vi.mock('../src/verify/lighthouse.js', () => ({ runLighthouse: (...a: unknown[]) => runLighthouse(...a) }))

const { processJob } = await import('../src/worker/process-job.js')

function fakeClickUp(taskName = 'Holiday announcement bar') {
  const calls = { comments: [] as string[], statuses: [] as string[], timeEntries: [] as number[] }
  return {
    client: {
      getTask: vi.fn().mockResolvedValue({ id: 'task_1', name: taskName, text_content: 'desc', status: { status: 'agent queue' }, tags: [] }),
      setStatus: vi.fn(async (_id: string, status: string) => {
        calls.statuses.push(status)
      }),
      createComment: vi.fn(async (_id: string, text: string) => {
        calls.comments.push(text)
        return { id: 'comment_1' }
      }),
      createTimeEntry: vi.fn(async (_id: string, ms: number) => {
        calls.timeEntries.push(ms)
      }),
      uploadAttachment: vi.fn().mockResolvedValue({ id: 'att_1', url: 'https://x/att_1' }),
    },
    calls,
  }
}

function makeDeps(clickUp: ReturnType<typeof fakeClickUp>['client']) {
  const db = new Database(':memory:')
  migrate(db)
  return { deps: { db, clickUp: clickUp as never, model: 'claude-sonnet-5', shopifyApiVersion: '2026-10', shopifyAdminApiToken: 'x' }, db }
}

beforeEach(() => {
  vi.clearAllMocks()
  ensureWorkspace.mockResolvedValue(undefined)
  checkoutTaskBranch.mockResolvedValue('task/task_1')
  commitWorkspace.mockResolvedValue(undefined)
  getLiveThemeId.mockResolvedValue('OLD-LIVE-1')
  publishTheme.mockResolvedValue(undefined)
  captureScreenshots.mockResolvedValue({ desktop: 'runs/x/desktop.png', mobile: 'runs/x/mobile.png' })
  runLighthouse.mockResolvedValue({ performanceScore: 80 })
})

describe('worker e2e: theme task through the full loop', () => {
  it('goes queued -> review -> revision -> review -> approved -> live', async () => {
    const { client, calls } = fakeClickUp()
    const { deps, db } = makeDeps(client)

    diffSummary.mockResolvedValue({ statText: '', filesChanged: ['sections/a.liquid'], insertions: 10, deletions: 1 })
    pushUnpublished.mockResolvedValue({ themeId: 'SL-task_1', previewUrl: 'https://preview/1' })
    runThemeAgent.mockResolvedValue({
      summary: 'Added announcement bar',
      filesChanged: ['sections/a.liquid'],
      assumptions: [],
      questionsForHuman: [],
    })

    // --- round 1: initial ---
    enqueueJob(db, { id: 'job-1', clickupTaskId: 'task_1', kind: 'initial', clientId: 'storeloop-demo' })
    await processJob(deps, getJob(db, 'job-1')!, 'theme-token')

    expect(calls.statuses).toEqual(['agent working', 'review'])
    expect(calls.comments[0]).toContain('Picked up')
    expect(calls.comments[1]).toContain('Round 1')
    expect(getJob(db, 'job-1')!.status).toBe('awaiting_review')
    const stateAfterRound1 = getTaskState(db, 'task_1')!
    expect(stateAfterRound1.round).toBe(1)
    expect(stateAfterRound1.unpublishedThemeId).toBe('SL-task_1')
    const hashAfterRound1 = stateAfterRound1.approvedPlanHash!

    // --- revision triggered by a human comment ---
    pushToExistingTheme.mockResolvedValue({ themeId: 'SL-task_1', previewUrl: 'https://preview/1' })
    runThemeAgent.mockResolvedValue({
      summary: 'Made it sticky on mobile only',
      filesChanged: ['sections/a.liquid'],
      assumptions: [],
      questionsForHuman: [],
    })
    enqueueJob(db, { id: 'job-2', clickupTaskId: 'task_1', kind: 'revision', clientId: 'storeloop-demo' })
    await processJob(deps, getJob(db, 'job-2')!, 'theme-token')

    expect(calls.statuses).toEqual(['agent working', 'review', 'review'])
    expect(calls.comments[2]).toContain('Round 2')
    expect(pushToExistingTheme).toHaveBeenCalledWith(expect.anything(), expect.anything(), 'SL-task_1')
    const stateAfterRound2 = getTaskState(db, 'task_1')!
    expect(stateAfterRound2.round).toBe(2)
    expect(stateAfterRound2.approvedPlanHash).not.toBe(hashAfterRound1)

    // --- approval arrives: publish job carries the plan hash snapshotted at approval time ---
    enqueueJob(db, { id: 'job-3', clickupTaskId: 'task_1', kind: 'publish', clientId: 'storeloop-demo', planHash: stateAfterRound2.approvedPlanHash! })
    await processJob(deps, getJob(db, 'job-3')!, 'theme-token')

    expect(calls.statuses).toEqual(['agent working', 'review', 'review', 'live'])
    expect(calls.comments[3]).toContain('Live')
    expect(calls.comments[3]).toContain('OLD-LIVE-1')
    expect(publishTheme).toHaveBeenCalledWith(expect.anything(), 'SL-task_1')
    expect(getJob(db, 'job-3')!.status).toBe('done')
    expect(getTaskState(db, 'task_1')!.status).toBe('live')
  })

  it('refuses to publish a stale approval (revision ran after approval was captured)', async () => {
    const { client, calls } = fakeClickUp()
    const { deps, db } = makeDeps(client)

    diffSummary.mockResolvedValue({ statText: '', filesChanged: ['a.liquid'], insertions: 1, deletions: 0 })
    pushUnpublished.mockResolvedValue({ themeId: 'SL-task_1', previewUrl: 'https://preview/1' })
    runThemeAgent.mockResolvedValue({ summary: 'v1', filesChanged: ['a.liquid'], assumptions: [], questionsForHuman: [] })

    enqueueJob(db, { id: 'job-1', clickupTaskId: 'task_1', kind: 'initial', clientId: 'storeloop-demo' })
    await processJob(deps, getJob(db, 'job-1')!, 'theme-token')
    const staleHash = getTaskState(db, 'task_1')!.approvedPlanHash!

    // A revision lands before the stale-approval publish job is processed.
    pushToExistingTheme.mockResolvedValue({ themeId: 'SL-task_1', previewUrl: 'https://preview/1' })
    runThemeAgent.mockResolvedValue({ summary: 'v2', filesChanged: ['a.liquid'], assumptions: [], questionsForHuman: [] })
    enqueueJob(db, { id: 'job-2', clickupTaskId: 'task_1', kind: 'revision', clientId: 'storeloop-demo' })
    await processJob(deps, getJob(db, 'job-2')!, 'theme-token')

    enqueueJob(db, { id: 'job-3', clickupTaskId: 'task_1', kind: 'publish', clientId: 'storeloop-demo', planHash: staleHash })
    await processJob(deps, getJob(db, 'job-3')!, 'theme-token')

    expect(publishTheme).not.toHaveBeenCalled()
    expect(getJob(db, 'job-3')!.status).toBe('failed')
    expect(calls.comments.at(-1)).toContain('no longer the latest')
    expect(calls.statuses.at(-1)).toBe('review')
  })

  it('posts a blocked comment and does not push when theme check / strict push fails', async () => {
    const { ThemePushFailedError } = await import('../src/shopify/theme.js')
    const { client, calls } = fakeClickUp()
    const { deps, db } = makeDeps(client)

    diffSummary.mockResolvedValue({ statText: '', filesChanged: ['a.liquid'], insertions: 1, deletions: 0 })
    pushUnpublished.mockRejectedValue(new ThemePushFailedError('Theme check failed. Please fix the errors before pushing.'))
    runThemeAgent.mockResolvedValue({ summary: 'v1', filesChanged: ['a.liquid'], assumptions: [], questionsForHuman: [] })

    enqueueJob(db, { id: 'job-1', clickupTaskId: 'task_1', kind: 'initial', clientId: 'storeloop-demo' })
    await processJob(deps, getJob(db, 'job-1')!, 'theme-token')

    expect(getJob(db, 'job-1')!.status).toBe('failed')
    expect(calls.statuses.at(-1)).toBe('blocked')
    expect(calls.comments.at(-1)).toContain('Blocked')
    expect(captureScreenshots).not.toHaveBeenCalled()
  })

  it('asks a question and skips the push when the agent makes no changes', async () => {
    const { client, calls } = fakeClickUp()
    const { deps, db } = makeDeps(client)

    diffSummary.mockResolvedValue({ statText: '', filesChanged: [], insertions: 0, deletions: 0 })
    runThemeAgent.mockResolvedValue({
      summary: 'unclear',
      filesChanged: [],
      assumptions: [],
      questionsForHuman: ['Which page should the banner appear on?'],
    })

    enqueueJob(db, { id: 'job-1', clickupTaskId: 'task_1', kind: 'initial', clientId: 'storeloop-demo' })
    await processJob(deps, getJob(db, 'job-1')!, 'theme-token')

    expect(pushUnpublished).not.toHaveBeenCalled()
    expect(calls.comments.at(-1)).toContain('Which page should the banner appear on?')
    expect(calls.statuses.at(-1)).toBe('review')
    expect(getJob(db, 'job-1')!.status).toBe('awaiting_review')
  })
})

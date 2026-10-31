import { logger } from '../logger.js'
import { ClickUpClient } from '../clickup/client.js'
import { loadClientConfig, type ClientConfig } from '../clients/config.js'
import { ensureWorkspace, checkoutTaskBranch, diffSummary, commitWorkspace } from '../shopify/workspace.js'
import { pushUnpublished, pushToExistingTheme, ThemePushFailedError, type ShopifyCliConfig } from '../shopify/theme.js'
import { publishApprovedTheme, PlanHashMismatchError } from '../shopify/publish.js'
import { executeApprovedAdminPlan } from '../shopify/admin-execute.js'
import { ShopifyAdminClient } from '../shopify/admin.js'
import { runThemeAgent } from '../agent/theme-agent.js'
import { runAdminAgent, adminAgentResultSchema, type AdminAgentResult } from '../agent/admin-agent.js'
import { captureScreenshots } from '../verify/screenshots.js'
import { runLighthouse } from '../verify/lighthouse.js'
import { detectTaskType } from './detect-task-type.js'
import { computePlanHash, STORELOOP_COMMENT_PREFIX } from '../policy.js'
import {
  renderThemeReviewComment,
  renderAdminPlanComment,
  renderQuestionsComment,
  renderPublishedComment,
  renderExecutedComment,
  renderBlockedComment,
  renderPlanStaleComment,
} from '../clickup/comment-template.js'
import {
  type Job,
  type TaskState,
  getTaskState,
  upsertTaskState,
  updateJob,
  writeAudit,
} from '../db.js'
import type Database from 'better-sqlite3'

const AGENT_TIMEOUT_MS = 10 * 60_000

export interface WorkerDeps {
  db: Database.Database
  clickUp: ClickUpClient
  model: string
  shopifyApiVersion: string
  shopifyAdminApiToken: string
}

async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
  })
  try {
    return await Promise.race([promise, timeout])
  } finally {
    clearTimeout(timer!)
  }
}

function shopifyCliConfig(client: ClientConfig, themeToken: string): ShopifyCliConfig {
  return { store: client.shopifyStore, themeToken }
}

async function fetchPriorComments(_clickUp: ClickUpClient, _taskId: string): Promise<string[]> {
  // ponytail: ClickUpClient has no "list comments" method yet (StoreLoop only ever posts its own
  // comments and reads the triggering one from the webhook payload); add listComments() if a
  // real revision round needs the full history rather than just the latest human comment.
  return []
}

async function postBlocked(clickUp: ClickUpClient, taskId: string, reason: string): Promise<void> {
  await clickUp.createComment(taskId, renderBlockedComment({ reason }))
  await clickUp.setStatus(taskId, 'blocked')
}

/** Dispatches one claimed job to the right flow. Never throws — failures end in status 'blocked'/'failed'. */
export async function processJob(deps: WorkerDeps, job: Job, themeToken: string): Promise<void> {
  const { db, clickUp } = deps
  try {
    switch (job.kind) {
      case 'initial':
      case 'revision':
        await processReviewRound(deps, job, themeToken)
        break
      case 'publish':
        await processPublish(deps, job, themeToken)
        break
      case 'execute':
        await processExecute(deps, job)
        break
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    logger.error({ jobId: job.id, err: message }, 'job failed')
    writeAudit(db, { jobId: job.id, tool: 'worker', summary: message, ok: false, durationMs: 0 })
    updateJob(db, job.id, { status: 'failed', error: message, finished: true })
    await postBlocked(clickUp, job.clickupTaskId, message).catch((e) =>
      logger.error({ jobId: job.id, err: String(e) }, 'failed to post blocked comment'),
    )
  }
}

async function processReviewRound(deps: WorkerDeps, job: Job, themeToken: string): Promise<void> {
  const { db, clickUp } = deps
  const taskId = job.clickupTaskId

  const task = await clickUp.getTask(taskId)
  let state = getTaskState(db, taskId)
  const clientId = job.clientId ?? state?.clientId
  if (!clientId) throw new Error('no client resolved for this task')
  const client = loadClientConfig(`clients/${clientId}.yaml`)
  const type = state?.type ?? detectTaskType(task)

  if (job.kind === 'initial') {
    await clickUp.setStatus(taskId, 'agent working')
    await clickUp.createComment(
      taskId,
      type === 'theme'
        ? `${STORELOOP_COMMENT_PREFIX} Picked up. Working on an unpublished copy.`
        : `${STORELOOP_COMMENT_PREFIX} Picked up. Building a dry-run plan.`,
    )
  }

  state = getTaskState(db, taskId) ?? {
    clickupTaskId: taskId,
    clientId,
    type,
    unpublishedThemeId: null,
    branch: null,
    round: 0,
    status: 'agent working',
    approvedPlanHash: null,
    lastCommentId: null,
  }
  const round = state.round + 1
  const priorComments = await fetchPriorComments(clickUp, taskId)

  updateJob(db, job.id, { status: 'running', type, clientId, round })

  if (type === 'theme') {
    await processThemeRound(deps, job, client, task, state, round, priorComments, themeToken)
  } else {
    await processAdminRound(deps, job, client, task, state, round, priorComments)
  }
}

async function processThemeRound(
  deps: WorkerDeps,
  job: Job,
  client: ClientConfig,
  task: { name: string; text_content: string },
  state: TaskState,
  round: number,
  priorComments: string[],
  themeToken: string,
): Promise<void> {
  const { db, clickUp } = deps
  const taskId = job.clickupTaskId
  const cliConfig = shopifyCliConfig(client, themeToken)

  await ensureWorkspace(client.themeRepoPath, cliConfig)
  const branch = await checkoutTaskBranch(client.themeRepoPath, taskId)

  const deniedCommands: string[] = []
  const startedAt = Date.now()
  const agentResult = await withTimeout(
    runThemeAgent({
      taskTitle: task.name,
      taskDescription: task.text_content,
      priorComments,
      brandFilePath: client.brandFilePath,
      workspaceDir: client.themeRepoPath,
      model: deps.model,
      onDenied: (denied) => {
        deniedCommands.push(`${denied.toolName}: ${denied.reason}`)
        writeAudit(db, {
          jobId: job.id,
          tool: denied.toolName,
          summary: `denied: ${denied.reason}`,
          ok: false,
          durationMs: 0,
        })
      },
    }),
    AGENT_TIMEOUT_MS,
    'theme agent run',
  )
  const agentTimeMs = Date.now() - startedAt
  writeAudit(db, { jobId: job.id, tool: 'theme-agent', summary: agentResult.summary, ok: true, durationMs: agentTimeMs })

  const diff = await diffSummary(client.themeRepoPath)

  if (diff.filesChanged.length === 0 && agentResult.questionsForHuman.length > 0) {
    await clickUp.createComment(taskId, renderQuestionsComment({ round, taskTitle: task.name, questions: agentResult.questionsForHuman }))
    await clickUp.setStatus(taskId, 'review')
    upsertTaskState(db, { ...state, round, status: 'review' })
    updateJob(db, job.id, { status: 'awaiting_review', finished: true })
    return
  }

  await commitWorkspace(client.themeRepoPath, `storeloop: round ${round}`)

  let pushed: { themeId: string; previewUrl: string }
  try {
    pushed =
      job.kind === 'initial' || !state.unpublishedThemeId
        ? await pushUnpublished(cliConfig, client.themeRepoPath, `SL-${taskId}`)
        : await pushToExistingTheme(cliConfig, client.themeRepoPath, state.unpublishedThemeId)
  } catch (err) {
    if (err instanceof ThemePushFailedError) {
      await postBlocked(clickUp, taskId, `theme check / push failed: ${err.message}`)
      updateJob(db, job.id, { status: 'failed', error: err.message, finished: true })
      return
    }
    throw err
  }

  const liveUrl = `https://${client.shopifyStore}`
  const [before, beforeShots] = await Promise.all([
    runLighthouse(liveUrl),
    captureScreenshots(liveUrl, `runs/${taskId}/round-${round}`, 'before'),
  ])
  const [after, afterShots] = await Promise.all([
    runLighthouse(pushed.previewUrl),
    captureScreenshots(pushed.previewUrl, `runs/${taskId}/round-${round}`, 'after'),
  ])

  for (const path of [beforeShots.desktop, beforeShots.mobile, afterShots.desktop, afterShots.mobile]) {
    await clickUp.uploadAttachment(taskId, path).catch((e) => logger.warn({ path, err: String(e) }, 'attachment upload failed'))
  }

  const planHash = computePlanHash({ themeId: pushed.themeId, round, filesChanged: diff.filesChanged, summary: agentResult.summary })

  const comment = renderThemeReviewComment({
    round,
    taskTitle: task.name,
    summary: agentResult.summary,
    previewThemeId: pushed.themeId,
    previewUrl: pushed.previewUrl,
    filesChanged: diff.filesChanged,
    insertions: diff.insertions,
    deletions: diff.deletions,
    themeCheckErrorCount: 0,
    lighthouseBefore: before.performanceScore,
    lighthouseAfter: after.performanceScore,
    assumptions:
      deniedCommands.length > 0
        ? [...agentResult.assumptions, `blocked by policy guardrail: ${deniedCommands.join('; ')}`]
        : agentResult.assumptions,
    questionsForHuman: agentResult.questionsForHuman,
    screenshotFilenames: [beforeShots.desktop, beforeShots.mobile, afterShots.desktop, afterShots.mobile].map((p) => p.split('/').pop()!),
    agentTimeMs,
  })

  await clickUp.createComment(taskId, comment)
  await clickUp.setStatus(taskId, 'review')
  await clickUp.createTimeEntry(taskId, agentTimeMs, 'agent').catch((e) => logger.warn({ err: String(e) }, 'time entry failed'))

  upsertTaskState(db, {
    clickupTaskId: taskId,
    clientId: state.clientId,
    type: 'theme',
    unpublishedThemeId: pushed.themeId,
    branch,
    round,
    status: 'review',
    approvedPlanHash: planHash,
  })
  updateJob(db, job.id, {
    status: 'awaiting_review',
    unpublishedThemeId: pushed.themeId,
    previewUrl: pushed.previewUrl,
    planHash,
    finished: true,
  })
}

async function processAdminRound(
  deps: WorkerDeps,
  job: Job,
  client: ClientConfig,
  task: { name: string; text_content: string },
  state: TaskState,
  round: number,
  priorComments: string[],
): Promise<void> {
  const { db, clickUp } = deps
  const taskId = job.clickupTaskId
  const adminClient = new ShopifyAdminClient({
    store: client.shopifyStore,
    apiVersion: deps.shopifyApiVersion,
    adminApiToken: deps.shopifyAdminApiToken,
  })
  const runsDir = `runs/${taskId}`

  const startedAt = Date.now()
  const plan = await withTimeout(
    runAdminAgent({ taskTitle: task.name, taskDescription: task.text_content, priorComments, runsDir, model: deps.model, adminClient }),
    AGENT_TIMEOUT_MS,
    'admin agent run',
  )
  const agentTimeMs = Date.now() - startedAt
  writeAudit(db, { jobId: job.id, tool: 'admin-agent', summary: `${plan.mutations.length} mutation(s) planned`, ok: true, durationMs: agentTimeMs })

  const planHash = computePlanHash(plan)
  await clickUp.createComment(
    taskId,
    renderAdminPlanComment({
      round,
      taskTitle: task.name,
      mutationCount: plan.mutations.length,
      affectedCount: plan.affectedCount,
      sample: plan.sample,
      risks: plan.risks,
      agentTimeMs,
    }),
  )
  await clickUp.setStatus(taskId, 'review')
  await clickUp.createTimeEntry(taskId, agentTimeMs, 'agent').catch((e) => logger.warn({ err: String(e) }, 'time entry failed'))

  upsertTaskState(db, { clickupTaskId: taskId, clientId: state.clientId, type: 'admin', round, status: 'review', approvedPlanHash: planHash })
  updateJob(db, job.id, { status: 'awaiting_review', planJson: JSON.stringify(plan), planHash, finished: true })
}

async function processPublish(deps: WorkerDeps, job: Job, themeToken: string): Promise<void> {
  const { db, clickUp } = deps
  const taskId = job.clickupTaskId
  const state = getTaskState(db, taskId)
  if (!state) throw new Error('no task_state for publish job')
  const client = loadClientConfig(`clients/${state.clientId}.yaml`)

  try {
    const result = await publishApprovedTheme(shopifyCliConfig(client, themeToken), state, job.planHash)
    await clickUp.createComment(taskId, renderPublishedComment({ previousLiveThemeId: result.previousLiveThemeId }))
    await clickUp.setStatus(taskId, 'live')
    upsertTaskState(db, { ...state, status: 'live' })
    updateJob(db, job.id, { status: 'done', finished: true })
  } catch (err) {
    if (err instanceof PlanHashMismatchError) {
      await clickUp.createComment(taskId, renderPlanStaleComment())
      await clickUp.setStatus(taskId, 'review')
      updateJob(db, job.id, { status: 'failed', error: err.message, finished: true })
      return
    }
    throw err
  }
}

async function processExecute(deps: WorkerDeps, job: Job): Promise<void> {
  const { db, clickUp } = deps
  const taskId = job.clickupTaskId
  const state = getTaskState(db, taskId)
  if (!state) throw new Error('no task_state for execute job')
  const client = loadClientConfig(`clients/${state.clientId}.yaml`)
  const adminClient = new ShopifyAdminClient({
    store: client.shopifyStore,
    apiVersion: deps.shopifyApiVersion,
    adminApiToken: deps.shopifyAdminApiToken,
  })

  const planRow = db.prepare(
    `SELECT plan_json FROM jobs WHERE clickup_task_id = ? AND plan_json IS NOT NULL ORDER BY created_at DESC LIMIT 1`,
  ).get(taskId) as { plan_json: string } | undefined
  if (!planRow) throw new Error('no stored plan found for this task')
  const plan: AdminAgentResult = adminAgentResultSchema.parse(JSON.parse(planRow.plan_json))

  try {
    const result = await executeApprovedAdminPlan(adminClient, state, plan, job.planHash, taskId)
    await clickUp.createComment(taskId, renderExecutedComment(result))
    await clickUp.setStatus(taskId, 'live')
    upsertTaskState(db, { ...state, status: 'live' })
    updateJob(db, job.id, { status: 'done', finished: true })
  } catch (err) {
    if (err instanceof PlanHashMismatchError) {
      await clickUp.createComment(taskId, renderPlanStaleComment())
      await clickUp.setStatus(taskId, 'review')
      updateJob(db, job.id, { status: 'failed', error: err.message, finished: true })
      return
    }
    throw err
  }
}

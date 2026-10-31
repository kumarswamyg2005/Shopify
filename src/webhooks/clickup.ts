import { z } from 'zod'
import { timingSafeEqual, createHmac } from 'node:crypto'
import { STORELOOP_COMMENT_PREFIX } from '../policy.js'

const historyItemSchema = z.object({
  id: z.string(),
  field: z.string().optional(),
  // ClickUp sends `after` as an object ({status: "..."}) for status changes but a bare string
  // (the new comment id) for comment events — accept either shape, verified against a real
  // webhook payload.
  after: z.unknown().optional(),
  comment: z.object({ text_content: z.string().optional() }).optional(),
})

function statusFromAfter(after: unknown): string | undefined {
  if (typeof after === 'object' && after !== null && 'status' in after) {
    const status = (after as { status: unknown }).status
    return typeof status === 'string' ? status : undefined
  }
  return undefined
}

export const clickUpWebhookEventSchema = z.object({
  event: z.string(),
  webhook_id: z.string(),
  task_id: z.string(),
  history_items: z.array(historyItemSchema).default([]),
})

export type ClickUpWebhookEvent = z.infer<typeof clickUpWebhookEventSchema>

/** HMAC-SHA256 of the raw body against the webhook secret, constant-time compare (invariant 4). */
export function verifySignature(
  rawBody: string,
  signatureHeader: string | null | undefined,
  secret: string,
): boolean {
  if (!signatureHeader) return false
  const expected = createHmac('sha256', secret).update(rawBody).digest('hex')
  const a = Buffer.from(expected, 'hex')
  const b = Buffer.from(signatureHeader, 'hex')
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

function isStoreLoopComment(text: string): boolean {
  return text.trimStart().startsWith(STORELOOP_COMMENT_PREFIX)
}

export interface RouteContext {
  /** false when the webhook_id doesn't map to a configured client/list (invariant: unknown list ignored). */
  knownWebhook: boolean
  /** the task's current ClickUp status, as StoreLoop last set it; used to gate comment-triggered revisions. */
  currentStatus?: string | undefined
}

export type RouteDecision =
  | { action: 'enqueue_initial' }
  | { action: 'enqueue_approved' }
  | { action: 'enqueue_revision' }
  | { action: 'ignore'; reason: string }

/**
 * Pure routing: webhook event + context -> what job (if any) to enqueue.
 * Status flow: agent queue -> enqueue_initial. approved -> enqueue_approved (orchestrator picks
 * publish vs execute from the job's stored type). A non-StoreLoop comment while the task is in
 * "review" -> enqueue_revision. Everything else is ignored.
 */
export function routeEvent(event: ClickUpWebhookEvent, ctx: RouteContext): RouteDecision {
  if (!ctx.knownWebhook) return { action: 'ignore', reason: 'unknown webhook/list' }

  if (event.event === 'taskStatusUpdated') {
    const after = statusFromAfter(event.history_items.find((item) => item.field === 'status')?.after)
    if (after === 'agent queue') return { action: 'enqueue_initial' }
    if (after === 'approved') return { action: 'enqueue_approved' }
    return { action: 'ignore', reason: `status not actionable: ${after ?? 'unknown'}` }
  }

  if (event.event === 'taskCommentPosted') {
    const text = event.history_items.find((item) => item.field === 'comment')?.comment?.text_content
    if (!text) return { action: 'ignore', reason: 'no comment text' }
    if (isStoreLoopComment(text)) return { action: 'ignore', reason: 'storeloop echo' }
    if (ctx.currentStatus !== 'review') return { action: 'ignore', reason: 'comment outside review' }
    return { action: 'enqueue_revision' }
  }

  return { action: 'ignore', reason: `unhandled event: ${event.event}` }
}

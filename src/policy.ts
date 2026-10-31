import { createHash } from 'node:crypto'
import { resolve, relative, isAbsolute } from 'node:path'

/**
 * StoreLoop non-negotiable invariants.
 *
 * 1. The agent process NEVER receives the Admin API token. Admin reads happen through
 *    orchestrator-provided read-only tools; admin writes happen only in the orchestrator, only
 *    after the task status becomes "approved", only replaying the exact plan the human reviewed.
 * 2. No code path ever passes --allow-live, --live, or calls theme publish except
 *    src/shopify/publish.ts, which runs only on status "approved" and refuses if the job's
 *    approved plan hash does not match the stored plan hash.
 * 3. The agent's Bash tool is wrapped by a canUseTool guard: deny any command containing
 *    --allow-live, --live, theme publish, theme delete, rm -rf, curl, wget, git push,
 *    or any path outside the task workspace. Denials are logged and reported in the ClickUp
 *    comment.
 * 4. Every ClickUp webhook is verified with HMAC-SHA256 of the raw body against the webhook
 *    secret (header X-Signature), constant-time compare. Unverified -> 401, no job created.
 * 5. Idempotency: each webhook history_items[].id is stored; duplicates are ignored. One active
 *    job per task at a time; a new comment during a run is queued as the next revision.
 * 6. Loop prevention: every comment StoreLoop posts starts with [StoreLoop]. Comments starting
 *    with that prefix never trigger a job.
 * 7. Admin plans are dry-run first: the plan lists every mutation, every affected resource ID,
 *    counts, and a before-snapshot. Execution writes a rollback file
 *    runs/<taskId>/rollback.json and posts it to the task.
 * 8. Destructive admin operations (delete product, delete collection, delete redirects in bulk,
 *    price changes) are refused in this PoC with a clear "out of scope, needs human" comment.
 * 9. Secrets only from .env via a zod-validated src/env.ts. Nothing secret is logged, posted
 *    to ClickUp, or written to runs/.
 * 10. Every agent action produces an audit entry (job id, task id, tool, args summary, result,
 *     duration) in SQLite and a human-readable summary in the ClickUp comment.
 * 11. Agent time per job is logged to ClickUp as a time entry tagged "agent".
 */

export const STORELOOP_COMMENT_PREFIX = '[StoreLoop]'

const DENIED_COMMAND_PATTERNS: RegExp[] = [
  /--allow-live\b/,
  /--live\b/,
  /\btheme\s+publish\b/,
  /\btheme\s+delete\b/,
  /\brm\s+-rf\b/,
  /\bcurl\b/,
  /\bwget\b/,
  /\bgit\s+push\b/,
]

export interface CommandCheckResult {
  allowed: boolean
  reason?: string
}

/**
 * Guard for the agent's Bash tool. Denies any command matching a forbidden pattern, and any
 * command that references a path outside `workspaceRoot` (invariant 3).
 */
export function checkCommand(command: string, workspaceRoot: string): CommandCheckResult {
  for (const pattern of DENIED_COMMAND_PATTERNS) {
    if (pattern.test(command)) {
      return { allowed: false, reason: `command matches denied pattern: ${pattern}` }
    }
  }

  const root = resolve(workspaceRoot)
  for (const token of command.split(/\s+/)) {
    if (!token.includes('/')) continue
    const candidate = isAbsolute(token) ? token : resolve(root, token)
    const rel = relative(root, candidate)
    if (rel.startsWith('..')) {
      return { allowed: false, reason: `path escapes workspace: ${token}` }
    }
  }

  return { allowed: true }
}

export const ALLOWED_ADMIN_MUTATIONS = [
  'tagsAdd',
  'tagsRemove',
  'collectionCreate',
  'urlRedirectCreate',
  'metafieldsSet',
] as const

export type AllowedAdminMutation = (typeof ALLOWED_ADMIN_MUTATIONS)[number]

export const DESTRUCTIVE_ADMIN_OPS = [
  'productDelete',
  'collectionDelete',
  'urlRedirectBulkDelete',
  'priceChange',
] as const

export function isAdminMutationAllowed(op: string): op is AllowedAdminMutation {
  return (ALLOWED_ADMIN_MUTATIONS as readonly string[]).includes(op)
}

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep)
  if (value !== null && typeof value === 'object') {
    const sorted: Record<string, unknown> = {}
    for (const key of Object.keys(value as object).sort()) {
      sorted[key] = sortKeysDeep((value as Record<string, unknown>)[key])
    }
    return sorted
  }
  return value
}

/** Stable hash of an admin or theme plan, used to detect stale approvals (invariant 2, 7). */
export function computePlanHash(plan: unknown): string {
  const canonical = JSON.stringify(sortKeysDeep(plan))
  return createHash('sha256').update(canonical).digest('hex')
}

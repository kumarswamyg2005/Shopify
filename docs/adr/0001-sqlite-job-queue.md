# ADR-0001: SQLite as the job queue, ingress/worker split in one process

**Status:** Accepted
**Date:** 2026-11-01
**Deciders:** solo build (Kumar Swamy)

## Context

A ClickUp webhook must be acknowledged fast (ClickUp retries/times out slow webhooks), but the
actual work — theme agent run, `shopify theme check`, Playwright screenshots, Lighthouse — takes
minutes. That rules out doing the work inline in the webhook handler. We need some durable
hand-off between "webhook received" and "work done" that survives the process restarting
mid-job, for one client, one store, one operator, on a laptop behind a tunnel.

## Decision

Split the app into an ingress (Hono routes that verify, dedupe, and insert a row) and a worker
(a polling loop over a `jobs` table) inside **one Node process**, backed by **SQLite**
(`better-sqlite3`) as the queue and system of record.

## Options Considered

### Option A: SQLite table as queue (chosen)
| Dimension | Assessment |
|-----------|------------|
| Complexity | Low — one file, no extra service to run or deploy |
| Cost | Free |
| Scalability | Fine for 1 client / low request volume; not horizontally scalable |
| Team familiarity | High — plain SQL, no new infra concepts |

**Pros:** zero extra infra for a laptop demo; transactional with the rest of the state
(`task_state`, `audit`) so a job and its audit trail commit together; trivial to inspect
(`sqlite3 data/storeloop.db`) while debugging live.
**Cons:** single-process only — two worker processes would double-claim jobs; no built-in
visibility/retry dashboard.

### Option B: Hosted queue (SQS / Cloud Tasks) + separate worker service
**Pros:** horizontally scalable, matches a real production deploy (Vercel/Netlify ingress +
worker on Fly/Railway).
**Cons:** another account, another secret, another thing to run locally for a demo that has to
work in one `npm run dev`; pure overhead for one client's job rate.

### Option C: In-memory queue, no persistence
**Pros:** simplest possible code.
**Cons:** loses in-flight jobs and the whole audit trail on restart — unacceptable given
invariant 10 (every agent action needs an audit entry) and the need to show "nothing was lost"
in the demo.

## Trade-off Analysis

The only reason to prefer B is horizontal scale, which this PoC does not need and the Loom does
not demonstrate. A is strictly less work and already gives durability and transactions for free.

## Consequences

- Easier: zero extra infra to run or explain in the Loom; one `npm run dev` is the whole system.
- Harder: adding a second concurrent worker later requires a real queue migration, not a config
  flag.
- Revisit: when there's more than one client with overlapping heavy jobs, move the queue to a
  hosted service and the worker to its own deployable (ingress stays on Vercel/Netlify per the
  adapter goal in the root prompt; see `docs/ARCHITECTURE.md` §7).

## Action Items

1. [x] `jobs` table with `status` column as the queue; worker polls `WHERE status='queued'`.
2. [ ] If a second client is ever added with real concurrency needs, write ADR-0005 for the
       queue migration before building it.

# StoreLoop architecture

## 1. Requirements

**Functional**
- A ClickUp task status change or comment triggers Shopify work (theme edit or admin change).
- An AI agent does the work on a non-live surface (unpublished theme, or a dry-run admin plan).
- Results post back to the ClickUp task as one comment with a preview link / plan, screenshots,
  and checks.
- A human approves or comments; comments trigger a revision; approval triggers publish/execute.
- Every irreversible action (theme publish, admin mutation) is gated on human approval and owned
  by the orchestrator, never the agent.

**Non-functional**
- Single client, single store, for this PoC (`storeloop-demo`); client config is data, not code,
  so adding a second client is a config file, not a deploy.
- Agent runs take minutes (theme edits, `theme check`, Lighthouse) — too slow for a typical
  serverless request/response cycle.
- Must survive the orchestrator process restarting mid-job without losing or double-running work.
- Runs on a single developer's laptop behind a `cloudflared` tunnel for the demo; no multi-region,
  no autoscaling, no SLA.

**Constraints**
- Stack is locked (see root prompt): TypeScript/Hono/SQLite/Shopify CLI/Claude Agent SDK.
- One operator, one store, one ClickUp list, for the demo. Design should not block scaling to
  many clients later, but should not build that now (see ADR 0001, ADR 0002).

## 2. High-level design

```
 ClickUp                         StoreLoop (single Node process)                  Shopify
 ┌────────┐  webhook (HMAC)     ┌──────────────────────────────┐   CLI / GraphQL  ┌────────┐
 │  task   │ ──────────────────▶│ Hono ingress  /webhooks/...   │                  │  store  │
 │ status/ │                    │   verify → zod → dedupe       │                  │ (theme, │
 │ comment │                    │   → insert row in jobs(sqlite)│                  │ admin)  │
 └────────┘                     └──────────────┬───────────────┘                  └────┬───┘
      ▲                                         │ polls jobs WHERE status='queued'      │
      │ comment / status / time entry           ▼                                        │
      │                          ┌──────────────────────────────┐                        │
      └──────────────────────────│         worker loop           │                        │
                                  │  THEME: git workspace, Claude │                        │
                                  │   Agent SDK (+Dev MCP, guarded│──── theme push ───────▶│
                                  │   Bash) → shopify CLI push    │     (unpublished only) │
                                  │  ADMIN: read-only MCP tools → │──── Admin GraphQL ─────▶│
                                  │   agent plan → allow-list     │     (reads; writes only │
                                  │   check → (on approval) exec  │      after "approved")  │
                                  └──────────────────────────────┘
```

Single Node process, two logical halves sharing one SQLite file:
- **Ingress** (Hono routes): verifies and records webhooks fast, never does Shopify/agent work
  inline.
- **Worker**: a polling loop over the `jobs` table that does the slow work (agent run, CLI calls,
  screenshots, Lighthouse) and is the only thing that calls `src/shopify/publish.ts` or executes
  admin mutations.

This split means a crash mid-job leaves a `running` row the worker can detect and re-queue/flag,
instead of losing an in-flight ClickUp webhook. See ADR 0001 for why SQLite-as-queue instead of a
hosted queue.

## 3. Data flow (theme task, happy path)

1. Human moves ClickUp task to "agent queue" → webhook → `jobs` row `kind=initial, status=queued`.
2. Worker claims the row (`status=running`), posts "[StoreLoop] picked up", sets ClickUp status
   "agent working".
3. Worker ensures the git workspace for the client exists, checks out `task/<taskId>`.
4. Worker screenshots + Lighthouses the **live** theme (before).
5. Claude Agent SDK runs in that workspace with Dev MCP tools and a guarded Bash tool
   (`src/policy.ts#checkCommand`); it edits files and returns a JSON summary.
6. Worker (not the agent) runs `shopify theme push --unpublished --json`, captures the preview
   theme id/url.
7. Worker screenshots + Lighthouses the **preview** (after).
8. Worker posts one ClickUp comment (template in DESIGN.md) with diff stat, checks, screenshots;
   sets status "review"; logs a time entry.
9. Human comments → revision job queued (step 2–8 repeat, reusing the branch/theme).
10. Human moves to "approved" → publish job: `src/shopify/publish.ts` verifies the stored plan
    hash still matches what was approved, then is the only code path that runs
    `shopify theme publish`.

Admin tasks follow the same shape but step 5's agent only gets read-only Shopify tools and
returns a mutation **plan** instead of editing files; step 6 is a dry-run validation against the
allow-list in `src/policy.ts`, and step 10's execute step writes `runs/<taskId>/rollback.json`
before mutating anything.

## 4. Storage

Single SQLite file (`data/storeloop.db`, via `better-sqlite3`), schema in the root prompt
(`clients`, `jobs`, `webhook_events`, `audit`, `task_state`). SQLite is sufficient at this scale
(one client, low request volume, single process) and gives free durability and transactions
without running a separate database service — see ADR 0001.

## 5. Reliability / failure handling

Handled case-by-case in `docs/adr/` and enforced in `src/policy.ts` + job state machine:
timeouts, `theme check` failures, throttling/backoff, duplicate webhooks, stale approvals (plan
hash mismatch), denied agent commands. Full list in the root build prompt's "Required failure
behaviours" — each becomes a `status='blocked'` job with the reason in the ClickUp comment, not a
silent retry loop.

## 6. What this does not do (by design, for a PoC)

- No multi-process scaling, no hosted queue, no horizontal workers (ADR 0001 names the upgrade
  path).
- No multi-tenant auth; `RUNS_BASIC_AUTH_*` is one shared operator credential for `/runs`.
- No destructive admin operations (delete, price change) — refused, not attempted.
- No platforms beyond Shopify; `src/adapters/` defines the interface others would implement.

## 7. What I'd revisit as this grows

- Queue: move from SQLite polling to a hosted queue once there's more than one worker process
  (ADR 0001).
- Multi-tenant: today's `clients/<id>.yaml` + `task_state` keyed by `clickup_task_id` already
  supports multiple clients; the next real change needed is one worker loop per client (or a
  concurrency limit) so one client's slow job can't starve another's.
- Observability: `pino` to a file is enough for a one-operator demo; a real retainer deployment
  wants structured logs shipped somewhere queryable, and the `/runs` page's job detail view
  becomes the first alerting signal (jobs stuck in `running`).

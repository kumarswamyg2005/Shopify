# ADR-0002: The agent never holds publish or admin-write capability

**Status:** Accepted
**Date:** 2026-11-01
**Deciders:** Kumaraswamy G

## Context

StoreLoop runs an LLM agent against a real Shopify store on an agency retainer. The agent can
hallucinate, misread a task, or be steered by adversarial content in a ClickUp comment. The
single most important guarantee for this product is: whatever the agent does, the live storefront
and live product data cannot change without a human looking at a diff/plan first.

## Decision

The agent process never receives the Shopify Admin API token (`SHOPIFY_ADMIN_API_TOKEN`), never
calls `shopify theme publish`, and never executes an admin mutation. It only:
- edits files in an **unpublished** theme's git workspace, or
- returns a **plan** (JSON) of proposed admin mutations, built from orchestrator-provided
  read-only tools.

Every irreversible action — `theme push --unpublished` → preview, `theme publish`, admin
mutation execution — is a function the **orchestrator** calls, gated on ClickUp status
`"approved"` and a plan-hash match (`src/policy.ts#computePlanHash`) against what the human
actually saw. The agent's Bash tool is wrapped by `checkCommand`, which denies
`--allow-live`/`--live`/`theme publish`/`theme delete`/`rm -rf`/`curl`/`wget`/`git push` and any
path outside the task workspace, independent of what the agent is told in its system prompt.

## Options Considered

### Option A: Capability separation, orchestrator-owned side effects (chosen)
**Pros:** a prompt-injection or hallucination in the agent can, at worst, produce a bad diff a
human rejects — it structurally cannot touch the live store. Matches invariant 1–3, 8.
**Cons:** more plumbing (read-only MCP tool wrappers, plan schema, hash check) than just giving
the agent the token and trusting its system prompt.

### Option B: Give the agent the Admin token, rely on prompt instructions ("never publish")
**Pros:** much less code.
**Cons:** a system prompt is not a security boundary; one bad task description or injected
comment and the agent can run anything the token allows. Unacceptable for a client's production
store.

### Option C: Human approves every individual tool call (interactive)
**Pros:** maximum human control.
**Cons:** defeats the point of an async ClickUp-driven loop; nobody wants to babysit a terminal
for a retainer ticket.

## Trade-off Analysis

B is cheaper but fails the product's core promise the moment the agent is wrong once. The extra
plumbing in A is the actual product, not incidental complexity — it's what differentiates this
from "point Claude Code at a theme repo."

## Consequences

- Easier: the thing being demoed to Ben ("the agent can't publish, can't see the admin token")
  is true by construction, not by instruction, and is provable from the denied-command log on /runs.
- Harder: every new theme/admin capability needs an explicit read-only tool or allow-listed
  mutation added by the orchestrator; the agent can't just "figure out" a new Admin API call.
- Revisit: if a future task type genuinely needs a new mutation, add it to
  `ALLOWED_ADMIN_MUTATIONS` deliberately (ADR, not silently) — see invariant 8's refusal list for
  what stays out (delete, price change).

## Action Items

1. [x] `src/policy.ts`: command guard, admin mutation allow-list, plan hash.
2. [ ] Theme agent process launched without `SHOPIFY_ADMIN_API_TOKEN` in its env (verify in
       `src/agent/run-theme-agent.ts` once written).
3. [ ] `src/shopify/publish.ts` is the only call site for `theme publish` (property test over
       all call sites, per the test plan).

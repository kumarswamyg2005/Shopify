# ADR-0003: Hono as the HTTP framework

**Status:** Accepted
**Date:** 2026-11-01
**Deciders:** solo build (Kumar Swamy)

## Context

The webhook ingress and `/runs` read-only UI need an HTTP server. The agency's existing stack
leans on serverless deploys (Vercel/Netlify), and the roadmap explicitly includes adapters for
Storyblok/Sanity/Craft/Vercel/Netlify, so whatever framework hosts the ingress today should not
need to be rewritten to run as a serverless function tomorrow.

## Decision

Use **Hono** (`hono` + `@hono/node-server`) for all HTTP routes.

## Options Considered

### Option A: Hono (chosen)
| Dimension | Assessment |
|-----------|------------|
| Complexity | Low — tiny API surface, no middleware ecosystem to learn |
| Cost | Free |
| Scalability | Runs on Node today; same route code runs on Vercel/Netlify edge/functions, Cloudflare Workers, Deno/Bun later via adapters, with no rewrite |
| Team familiarity | New to this build, but Express-shaped enough to pick up in minutes |

**Pros:** one codebase for "runs on my laptop via `@hono/node-server`" today and "deploys to
Vercel/Netlify" later (the stated production path), without a framework migration.
**Cons:** smaller middleware ecosystem than Express.

### Option B: Express
**Pros:** most familiar, huge ecosystem.
**Cons:** Node-only; moving to Vercel/Netlify functions later means either running it inside a
single catch-all function (works, but loses Hono's native edge-adapter model) or a rewrite.

### Option C: Raw `node:http`
**Pros:** zero dependency.
**Cons:** we'd hand-roll routing, JSON body parsing, and basic-auth middleware for `/runs` —
Hono gives all three in a few lines; not worth reinventing.

## Trade-off Analysis

Express would work fine for the demo itself; the deciding factor is the stated adapter roadmap
(Storyblok/Sanity/Craft/Netlify/Vercel), where Hono's multi-runtime adapters are the actual
reason to pick it over the more familiar option.

## Consequences

- Easier: later deploying the ingress to Vercel/Netlify is a `hono/vercel` / `hono/netlify`
  adapter import, not a rewrite.
- Harder: less Stack Overflow precedent than Express for edge cases; worth budgeting a bit more
  time when something is undocumented.
- Revisit: if the worker loop itself ever needs to move off a long-running Node process (it
  currently must, for the SQLite-polling design in ADR-0001), Hono doesn't help or hurt that —
  it only affects the ingress half.

## Action Items

1. [ ] `src/server.ts`: Hono app, `@hono/node-server` to run it locally.
2. [ ] Keep route handlers framework-agnostic where possible (plain functions taking parsed
       input) so a future edge adapter only touches the thin Hono wiring.

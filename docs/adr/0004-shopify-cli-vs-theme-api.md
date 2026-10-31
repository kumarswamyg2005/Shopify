# ADR-0004: Shopify CLI for theme operations, raw Admin GraphQL for admin operations

**Status:** Accepted
**Date:** 2026-11-01
**Deciders:** solo build (Kumar Swamy)

## Context

Theme work (push to an unpublished theme, `theme check`, publish) and admin work (tag products,
create a collection, create redirects) both talk to Shopify, but through different surfaces:
the Theme API has no simple "push a directory of files" primitive, while Admin mutations are
plain GraphQL with no CLI equivalent worth using.

## Decision

- **Theme operations** go through the **Shopify CLI** (`shopify theme push/pull/check/publish`),
  invoked non-interactively via `execa` with `SHOPIFY_CLI_THEME_TOKEN` (Theme Access password)
  and `--json` wherever the CLI supports it, parsed as structured output — never scraped from
  human-readable text.
- **Admin operations** go through the **Admin GraphQL API** directly via `fetch`, pinned to
  `SHOPIFY_API_VERSION`, with cursor-based pagination for anything bulk.

## Options Considered

### Option A: CLI for themes, raw GraphQL for admin (chosen)
**Pros:** the CLI already implements theme diffing, asset upload, Liquid syntax checking
(`theme check`), and unpublished-theme push/publish correctly and matches how a human developer
on this agency would do it by hand — reusing that beats reimplementing it against the raw Theme
API. Admin mutations have no CLI equivalent, so raw GraphQL is the only sane option there, and
it gives full control over exactly which fields are returned and which mutations are allowed
(the allow-list in `src/policy.ts` is enforced at the GraphQL call site).
**Cons:** two different integration styles (shell subprocess vs. HTTP) in one codebase.

### Option B: Raw Theme API (Asset endpoints) for theme work too
**Pros:** one integration style (GraphQL/REST) for everything, no subprocess.
**Cons:** reimplements asset diffing/upload batching and Liquid validation the CLI already does
well; `theme check` has no API equivalent at all, so this option still needs the CLI for linting
— it wouldn't actually remove the dependency.

### Option C: Shopify CLI for admin work too (via a hypothetical script mode)
**Pros:** one tool.
**Cons:** the CLI has no general-purpose GraphQL execution mode suited to programmatic
pagination, rate-limit backoff, and structured allow-list enforcement; raw `fetch` is simpler and
more controllable here.

## Trade-off Analysis

Running two integration styles is a one-time cost in `src/shopify/{theme.ts,admin.ts}`; the
alternative in both directions is reimplementing something Shopify's own tooling already does
correctly (CLI for theme push/check, GraphQL for admin mutations).

## Consequences

- Easier: theme pushes get Shopify's own validation and diffing for free; admin mutations get
  exact control over what's queryable/mutable, which is where the allow-list (ADR-0002) lives.
- Harder: theme operations depend on the CLI being installed and the Theme Access token being
  valid in the environment running the worker, not just an API key — documented in
  `docs/RUNBOOK.md`.
- Revisit: if Shopify ships a stable programmatic (non-CLI) theme push API, re-evaluate — but not
  before then; speculative now.

## Action Items

1. [ ] `src/shopify/theme.ts`: `execa` wrapper for `pull`, `push --unpublished --strict --json`,
       `theme check`, and the gated `publish`.
2. [ ] `src/shopify/admin.ts`: typed GraphQL client with cursor pagination and 429/THROTTLED
       backoff.

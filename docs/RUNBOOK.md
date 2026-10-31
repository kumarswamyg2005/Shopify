# StoreLoop runbook

## When to use this

Something is wrong with a live StoreLoop run, a token expired, or you need to roll a published
theme back. This is an operator doc — you need shell access to the machine running StoreLoop and
the credentials in `.env`.

## Rolling back a published theme

Every "Live" comment StoreLoop posts names the previous live theme's id
(`Previous theme <id> kept for one-click rollback.`). To roll back:

```sh
shopify theme publish --theme <previous-theme-id> --store <store> --password "$SHOPIFY_CLI_THEME_TOKEN" --force
```

This is a manual step by design — StoreLoop's own invariant 2 is that only a human-triggered
"approved" status publishes a theme, and a rollback is exactly that kind of decision.

## Rolling back an admin plan

Open `runs/<taskId>/rollback.json`. Each entry has a `rollbackHint` describing the inverse
operation. `tagsAdd`/`tagsRemove` rollbacks can be re-run directly through the same allow-listed
mutations (ask the agent to do it as a new task, or call `ShopifyAdminClient` directly); created
collections and redirects need manual deletion in Shopify admin — StoreLoop deliberately never
auto-executes a delete (invariant 8).

## Rotating tokens

All four live in `.env`, read once at process start — restart `npm run dev` / the deployed
process after changing any of them.

| Token | Where to get a new one |
|---|---|
| `ANTHROPIC_API_KEY` | console.anthropic.com |
| `SHOPIFY_ADMIN_API_TOKEN` | Shopify Admin → Settings → Apps → Develop apps → the StoreLoop app → Credentials → reveal/regenerate |
| `SHOPIFY_CLI_THEME_TOKEN` | the Theme Access app on the store → regenerate the password |
| `CLICKUP_API_TOKEN` | ClickUp → Settings → Apps → regenerate |

None of these are logged or ever sent to ClickUp (invariant 9) — if one leaks, rotating it here
is sufficient; there's no second place it's cached.

## Re-registering the ClickUp webhook

The webhook secret lives in `data/webhook-secret.json` (mode `0600`, gitignored) and the
webhook-id → client mapping in `data/webhooks.json`. You need to re-register whenever:

- the tunnel URL changes (every `cloudflared tunnel --url ...` quick-tunnel run gets a new host)
- `data/` was deleted or you're setting up a fresh checkout
- ClickUp reports the webhook as `failing` with a rising `fail_count` and it isn't a transient
  tunnel blip (check `GET https://api.clickup.com/api/v2/team/<id>/webhook` with your token)

```sh
npm run dev                                           # in one terminal
cloudflared tunnel --url http://localhost:8787         # in another — note the https URL it prints
npm run register-webhook -- storeloop-demo https://<tunnel-host>/webhooks/clickup
```

Registering again overwrites the stored secret and registration — any webhook ClickUp still has
pointed at an old secret will start failing signature verification, which is expected after a
re-register.

## Common failure signatures

| Symptom | Likely cause | Where to look |
|---|---|---|
| Webhook returns 401 | Secret mismatch — re-register | `data/webhook-secret.json`, this doc's section above |
| Job stuck in `running` | Worker crashed mid-job | `logs/storeloop.log`; restart the process, the job stays `running` and needs a manual status fix in sqlite (`UPDATE jobs SET status='failed' WHERE id=...`) |
| Task stuck in `blocked` | Theme check / strict push failed, or the agent hit the 10-minute timeout | The ClickUp "Blocked" comment has the reason; `/runs/<jobId>` has the audit timeline |
| Publish refused with "no longer the latest" | A revision ran after approval (invariant 2 working as intended) | Re-approve the newest round |
| Screenshots/Lighthouse show a password page | The dev store's storefront password is still on | Online Store → Preferences → turn off password protection |

## Escalation

This is a one-operator PoC — there's no on-call. If something's wrong in a way this runbook
doesn't cover, check `logs/storeloop.log` and `/runs/<jobId>` first; both have the full audit
trail for any job.

# Pre-Loom deploy checklist

StoreLoop's "deploy" for this PoC is: clean clone, real credentials, real ClickUp list, real dev
store. No CI, no staging, no canary — one operator, one laptop. Run this before every recording.

### Code

- [ ] `npm ci && npm test` passes on a clean clone (no stray local state carried over)
- [ ] `npx tsc --noEmit` and `npx eslint .` both clean
- [ ] No secrets in git history: `git log -p | grep -iE "shpat_|shptka_|sk-ant-|pk_[0-9]"` is empty
- [ ] `.env` is gitignored and `.env.example` is committed and current

### Shopify

- [ ] Horizon is the **live** theme (not a seed/sample theme — confirmed in-session that this
      matters: a seed theme can fail `theme check --strict` on its own, unrelated to any task)
- [ ] Storefront password protection is **off** (Online Store → Preferences) — otherwise every
      screenshot and Lighthouse run hits a password wall
- [ ] No leftover `SL-*` unpublished themes from a previous run (`npm run demo-reset`)

### ClickUp

- [ ] The six custom statuses exist on the `storeloop-demo` list in this exact order: `agent
      queue`, `agent working`, `review`, `approved`, `live`, `blocked`
- [ ] Demo tasks reset to `agent queue` (`npm run demo-reset`, or `npm run seed-tasks` fresh)
- [ ] The registered webhook is `active` (not `failing`) — see docs/RUNBOOK.md if not

### Live run

- [ ] `npm run dev` + `cloudflared tunnel --url http://localhost:8787` + `npm run
      register-webhook -- storeloop-demo <tunnel-url>/webhooks/clickup`
- [ ] Move the theme demo task to "agent queue" → preview comment with screenshots lands in
      ClickUp, live theme untouched (check the Themes page)
- [ ] Comment a revision → round 2 lands on the same unpublished theme
- [ ] Approve → live, with the previous theme id for rollback
- [ ] Move the admin demo task to "agent queue" → dry-run plan comment, nothing executed yet
- [ ] Approve → `runs/<taskId>/rollback.json` exists and the comment names the executed count
- [ ] `/runs` (basic auth) shows both jobs with a correct audit timeline

### Recording

- [ ] No token visible anywhere on screen (terminal scrollback, `.env` file, browser address bar)
- [ ] Browser zoomed to a readable size, mic checked
- [ ] `npm run demo-reset` run immediately before hitting record, not after

### Rollback triggers (if something breaks mid-recording)

- A job is stuck in `running` for more than ~2 minutes with no ClickUp comment → stop, check
  `logs/storeloop.log`, don't keep recording against a hung worker
- The storefront shows a password wall in a screenshot → stop, fix the store setting, re-run
  `demo-reset`, restart the recording

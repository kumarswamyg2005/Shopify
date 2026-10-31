import type { Job } from '../db.js'

const STYLE = `
  :root {
    --paper: #F6F3EE; --ink: #1B1A17; --muted: #6E6A63; --rule: #DDD7CC;
    --accent: #8C2F1C; --ok: #2F5D46; --fail: #8C2F1C;
  }
  * { box-sizing: border-box; }
  body {
    background: var(--paper); color: var(--ink); margin: 0;
    font-family: Georgia, 'Newsreader', serif;
    padding: 16px;
  }
  @media (min-width: 640px) { body { padding: 48px; } }
  .wrap { max-width: 1080px; margin: 0 auto; }
  h1 { font-size: 28px; font-weight: 500; margin: 0; }
  .meta { font-family: ui-monospace, 'IBM Plex Mono', monospace; font-size: 13px; color: var(--muted); }
  header.page { display: flex; justify-content: space-between; align-items: baseline; border-bottom: 1px solid var(--rule); padding-bottom: 12px; margin-bottom: 8px; }
  table { width: 100%; border-collapse: collapse; }
  th, td { text-align: left; padding: 8px 12px 8px 0; border-bottom: 1px solid var(--rule); font-size: 14px; }
  th { font-family: ui-monospace, 'IBM Plex Mono', monospace; font-size: 12px; color: var(--muted); font-weight: 400; text-transform: none; }
  td.mono, th.mono { font-family: ui-monospace, 'IBM Plex Mono', monospace; }
  .status-awaiting_review::before { content: '● '; color: var(--accent); }
  .status-done::before, .status-live::before { content: '● '; color: var(--ok); }
  .status-failed::before, .status-blocked::before { content: '● '; color: var(--fail); }
  a { color: var(--ink); }
  .back { font-family: ui-monospace, 'IBM Plex Mono', monospace; font-size: 13px; }
  .columns { display: grid; grid-template-columns: 1fr; gap: 24px; margin-top: 24px; }
  @media (min-width: 900px) { .columns { grid-template-columns: 1fr 1fr; } }
  .timeline { font-family: ui-monospace, 'IBM Plex Mono', monospace; font-size: 13px; }
  .timeline div { padding: 6px 0; border-bottom: 1px solid var(--rule); }
  .shots img { width: 100%; border: 1px solid var(--rule); margin-bottom: 12px; }
  .empty { color: var(--muted); font-style: italic; }
`

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
}

function timeAgo(iso: string | null): string {
  if (!iso) return '-'
  const ms = Date.now() - new Date(`${iso}Z`).getTime()
  const mins = Math.round(ms / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours}h`
  return `${Math.round(hours / 24)}d`
}

function page(title: string, body: string): string {
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <style>${STYLE}</style>
</head>
<body><div class="wrap">${body}</div></body>
</html>`
}

export function renderRunsList(jobs: Job[], queueDepth: number, lastJobAt: string | null): string {
  const rows = jobs
    .map(
      (job) => `
      <tr>
        <td class="mono"><a href="/runs/${job.id}">${escapeHtml(job.clickupTaskId)}</a></td>
        <td>${escapeHtml(job.clientId ?? '-')}</td>
        <td class="mono">${escapeHtml(job.type ?? '-')}</td>
        <td class="mono">${job.round ?? '-'}</td>
        <td class="mono status-${job.status}">${escapeHtml(job.status)}</td>
        <td class="mono">${escapeHtml(job.kind)}</td>
      </tr>`,
    )
    .join('')

  const body = `
    <header class="page">
      <h1>StoreLoop</h1>
      <span class="meta">queue ${queueDepth} &middot; last ${timeAgo(lastJobAt)} ago</span>
    </header>
    ${
      jobs.length === 0
        ? '<p class="empty">No jobs yet.</p>'
        : `<table>
      <thead><tr><th>TASK</th><th>CLIENT</th><th>TYPE</th><th>ROUND</th><th>STATUS</th><th>KIND</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`
    }
  `
  return page('StoreLoop — runs', body)
}

export interface AuditRow {
  tool: string
  summary: string
  ok: number
  duration_ms: number
  at: string
}

export function renderJobDetail(job: Job, audit: AuditRow[], screenshotFiles: string[]): string {
  const timeline = audit.length
    ? audit.map((a) => `<div>${escapeHtml(a.at)} &middot; ${escapeHtml(a.tool)} &middot; ${a.ok ? 'ok' : 'denied/failed'} &middot; ${escapeHtml(a.summary)}</div>`).join('')
    : '<p class="empty">No audit entries.</p>'

  const shots = screenshotFiles.length
    ? screenshotFiles.map((f) => `<img src="/runs/${job.id}/shot/${encodeURIComponent(f)}" alt="${escapeHtml(f)}" />`).join('')
    : '<p class="empty">No screenshots.</p>'

  const body = `
    <p class="back"><a href="/runs">&larr; runs</a></p>
    <header class="page">
      <h1>${escapeHtml(job.clickupTaskId)}</h1>
      <span class="meta status-${job.status}">${escapeHtml(job.status)}</span>
    </header>
    <p class="meta">client ${escapeHtml(job.clientId ?? '-')} &middot; type ${escapeHtml(job.type ?? '-')} &middot; kind ${escapeHtml(job.kind)} &middot; round ${job.round ?? '-'}</p>
    ${job.previewUrl ? `<p class="meta">preview: <a href="${escapeHtml(job.previewUrl)}">${escapeHtml(job.previewUrl)}</a></p>` : ''}
    ${job.error ? `<p class="meta status-failed">${escapeHtml(job.error)}</p>` : ''}
    <div class="columns">
      <div class="timeline">${timeline}</div>
      <div class="shots">${shots}</div>
    </div>
  `
  return page(`StoreLoop — ${job.clickupTaskId}`, body)
}

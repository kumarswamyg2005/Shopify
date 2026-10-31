// Thin CLI wrapper around POST /admin/register-webhook on the already-running local server.
// Usage: npm run register-webhook -- <clientId> <endpointUrl>
import { env } from '../src/env.js'

const [, , clientId, endpointUrl] = process.argv
if (!clientId || !endpointUrl) {
  console.error('Usage: npm run register-webhook -- <clientId> <endpointUrl>')
  console.error('Example: npm run register-webhook -- storeloop-demo https://your-tunnel.trycloudflare.com/webhooks/clickup')
  process.exit(1)
}

const auth = Buffer.from(`${env.RUNS_BASIC_AUTH_USER}:${env.RUNS_BASIC_AUTH_PASS}`).toString('base64')
const res = await fetch(`http://localhost:${env.PORT}/admin/register-webhook`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Basic ${auth}` },
  body: JSON.stringify({ clientId, endpointUrl }),
})
const body = await res.json()
if (!res.ok || !body.ok) {
  console.error('Failed:', body)
  process.exit(1)
}
console.log(`Registered webhook ${body.webhookId} for ${clientId} -> ${endpointUrl}`)

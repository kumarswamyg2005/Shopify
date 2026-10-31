import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { randomBytes } from 'node:crypto'

const SECRET_PATH = 'data/webhook-secret.json'
const WEBHOOKS_PATH = 'data/webhooks.json'

export function readWebhookSecret(): string | null {
  if (!existsSync(SECRET_PATH)) return null
  const { secret } = JSON.parse(readFileSync(SECRET_PATH, 'utf8')) as { secret: string }
  return secret
}

export function writeWebhookSecret(secret: string): void {
  mkdirSync('data', { recursive: true })
  writeFileSync(SECRET_PATH, JSON.stringify({ secret }), { mode: 0o600 })
}

/** A secret nothing can ever match, used when none has been registered yet — fails closed. */
export function unregisteredSecretFallback(): string {
  return randomBytes(32).toString('hex')
}

export interface WebhookRegistration {
  webhookId: string
  clientId: string
}

export function readWebhookRegistrations(): WebhookRegistration[] {
  if (!existsSync(WEBHOOKS_PATH)) return []
  return JSON.parse(readFileSync(WEBHOOKS_PATH, 'utf8')) as WebhookRegistration[]
}

export function writeWebhookRegistration(reg: WebhookRegistration): void {
  const existing = readWebhookRegistrations().filter((r) => r.webhookId !== reg.webhookId)
  mkdirSync('data', { recursive: true })
  writeFileSync(WEBHOOKS_PATH, JSON.stringify([...existing, reg], null, 2))
}

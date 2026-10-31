import { readFileSync } from 'node:fs'
import { parse } from 'yaml'
import { z } from 'zod'

/** Also used wherever an external request supplies a clientId that ends up in a file path (e.g.
 * POST /admin/register-webhook) — restrictive on purpose, to rule out path traversal at the
 * schema boundary rather than relying on the filesystem call site to sanitize it. */
export const clientIdSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9-]+$/, 'clientId must be lowercase alphanumeric with hyphens only')

export const clientConfigSchema = z.object({
  id: clientIdSchema,
  name: z.string(),
  shopifyStore: z.string().endsWith('.myshopify.com'),
  clickupListId: z.string(),
  clickupSpaceId: z.string(),
  themeRepoPath: z.string(),
  brandFilePath: z.string(),
  allowedTaskTypes: z.array(z.enum(['theme', 'admin'])),
})

export type ClientConfig = z.infer<typeof clientConfigSchema>

export function loadClientConfig(path: string): ClientConfig {
  const raw = parse(readFileSync(path, 'utf8'))
  return clientConfigSchema.parse(raw)
}

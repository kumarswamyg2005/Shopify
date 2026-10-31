import { readFileSync } from 'node:fs'
import { parse } from 'yaml'
import { z } from 'zod'

export const clientConfigSchema = z.object({
  id: z.string(),
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

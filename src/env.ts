import { z } from 'zod'

const schema = z.object({
  ANTHROPIC_API_KEY: z.string().min(1),
  STORELOOP_MODEL: z.string().default('claude-sonnet-5'),

  SHOPIFY_STORE: z.string().min(1).endsWith('.myshopify.com'),
  SHOPIFY_API_VERSION: z.string().min(1),
  SHOPIFY_ADMIN_API_TOKEN: z.string().min(1),
  SHOPIFY_CLI_THEME_TOKEN: z.string().min(1),

  CLICKUP_API_TOKEN: z.string().min(1),
  CLICKUP_WORKSPACE_ID: z.string().min(1),

  PORT: z.coerce.number().int().positive().default(8787),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  RUNS_BASIC_AUTH_USER: z.string().min(1),
  RUNS_BASIC_AUTH_PASS: z.string().min(1),
})

export type Env = z.infer<typeof schema>

function loadEnv(): Env {
  const result = schema.safeParse(process.env)
  if (!result.success) {
    const issues = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n')
    throw new Error(`Invalid environment configuration:\n${issues}`)
  }
  return result.data
}

export const env = loadEnv()

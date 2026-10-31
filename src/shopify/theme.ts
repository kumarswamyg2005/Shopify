import { execa } from 'execa'
import { z } from 'zod'

export interface ShopifyCliConfig {
  store: string
  themeToken: string
}

export class ThemeCheckFailedError extends Error {
  constructor(public readonly output: unknown) {
    super('shopify theme check reported errors')
  }
}

export class ThemePushFailedError extends Error {
  constructor(message: string) {
    super(message)
  }
}

function run(config: ShopifyCliConfig, args: string[], cwd?: string) {
  return execa('shopify', [...args, '--store', config.store, '--password', config.themeToken, '--no-input'], {
    ...(cwd ? { cwd } : {}),
    env: { SHOPIFY_CLI_THEME_TOKEN: config.themeToken },
  })
}

function parseJsonStdout<T>(stdout: string): T {
  // `shopify theme ... --json` can still print a leading CLI banner line on some setups —
  // take the JSON object/array, not the raw text, exactly as the spec requires.
  const start = stdout.search(/[[{]/)
  if (start === -1) throw new ThemePushFailedError(`no JSON found in CLI output: ${stdout}`)
  const parsed = JSON.parse(stdout.slice(start)) as T | { error: { message: string } }
  if (parsed !== null && typeof parsed === 'object' && 'error' in parsed) {
    // The CLI's own non-interactive abort shape, e.g. `theme check` failing a `--strict` push:
    // {"error":{"type":"abort","message":"Theme check failed. Please fix the errors before pushing."}}
    throw new ThemePushFailedError(parsed.error.message)
  }
  return parsed as T
}

/** Pulls the store's live theme into `destDir` — the baseline for a new client git workspace. */
export async function pullLiveTheme(config: ShopifyCliConfig, destDir: string): Promise<void> {
  await run(config, ['theme', 'pull', '--live', '--path', destDir, '--force', '--json'])
}

export interface PushUnpublishedResult {
  themeId: string
  previewUrl: string
}

const pushJsonSchema = z.object({
  theme: z.object({
    id: z.union([z.string(), z.number()]),
    previewUrl: z.string().optional(),
  }),
})

/** Pushes `srcDir` to a new (or existing, by name) unpublished theme. Never publishes. */
export async function pushUnpublished(
  config: ShopifyCliConfig,
  srcDir: string,
  themeName: string,
): Promise<PushUnpublishedResult> {
  const { stdout } = await run(config, [
    'theme',
    'push',
    '--unpublished',
    '--theme',
    themeName,
    '--path',
    srcDir,
    '--strict',
    '--force',
    '--json',
  ])
  const parsed = pushJsonSchema.parse(parseJsonStdout(stdout))
  return {
    themeId: String(parsed.theme.id),
    previewUrl: parsed.theme.previewUrl ?? `https://${config.store}?preview_theme_id=${parsed.theme.id}`,
  }
}

const themeCheckSchema = z.object({
  valid: z.boolean(),
  issues: z.array(
    z.object({
      filePath: z.string(),
      check: z.string(),
      severity: z.string(),
      message: z.string(),
    }),
  ),
})

export type ThemeCheckIssue = z.infer<typeof themeCheckSchema>['issues'][number]

/** Runs `theme check`; throws ThemeCheckFailedError (default fail-level: any "error" severity). */
export async function themeCheck(srcDir: string): Promise<ThemeCheckIssue[]> {
  const result = await execa('shopify', ['theme', 'check', '--path', srcDir, '--output', 'json'], {
    reject: false,
  })
  const parsed = themeCheckSchema.parse(JSON.parse(result.stdout))
  if (result.exitCode !== 0 || !parsed.valid) {
    throw new ThemeCheckFailedError(parsed.issues)
  }
  return parsed.issues
}

/** Pushes a revision to the same unpublished theme created by an earlier pushUnpublished call. */
export async function pushToExistingTheme(
  config: ShopifyCliConfig,
  srcDir: string,
  themeId: string,
): Promise<PushUnpublishedResult> {
  const { stdout } = await run(config, ['theme', 'push', '--theme', themeId, '--path', srcDir, '--strict', '--force', '--json'])
  const parsed = pushJsonSchema.parse(parseJsonStdout(stdout))
  return {
    themeId: String(parsed.theme.id),
    previewUrl: parsed.theme.previewUrl ?? `https://${config.store}?preview_theme_id=${parsed.theme.id}`,
  }
}

/**
 * The only call site in this codebase allowed to run `theme publish` (invariant 2). The caller
 * (src/shopify/publish.ts) is responsible for verifying the approved plan hash before calling this.
 */
export async function publishTheme(config: ShopifyCliConfig, themeId: string): Promise<void> {
  await run(config, ['theme', 'publish', '--theme', themeId, '--force'])
}

const themeListSchema = z.object({
  themes: z.array(z.object({ id: z.union([z.string(), z.number()]), role: z.string() })),
})

export async function getLiveThemeId(config: ShopifyCliConfig): Promise<string | null> {
  const { stdout } = await run(config, ['theme', 'list', '--json'])
  const parsed = themeListSchema.parse(parseJsonStdout(stdout))
  const live = parsed.themes.find((t) => t.role === 'live')
  return live ? String(live.id) : null
}

export async function deleteUnpublishedTheme(config: ShopifyCliConfig, themeId: string): Promise<void> {
  await run(config, ['theme', 'delete', '--theme', themeId, '--force'])
}

import { execa } from 'execa'
import { existsSync, mkdirSync } from 'node:fs'
import { pullLiveTheme, type ShopifyCliConfig } from './theme.js'

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execa('git', args, { cwd })
  return stdout
}

/** Ensures the client's theme git workspace exists, pulling the live theme as the baseline once. */
export async function ensureWorkspace(repoPath: string, config: ShopifyCliConfig): Promise<void> {
  if (existsSync(`${repoPath}/.git`)) return
  mkdirSync(repoPath, { recursive: true })
  await pullLiveTheme(config, repoPath)
  await git(repoPath, ['init', '-q'])
  await git(repoPath, ['add', '-A'])
  await git(repoPath, ['commit', '-q', '-m', 'Baseline from live theme', '--allow-empty'])
}

/** Checks out `task/<taskId>`, creating it from the current branch if it doesn't exist yet. */
export async function checkoutTaskBranch(repoPath: string, taskId: string): Promise<string> {
  const branch = `task/${taskId}`
  const branches = await git(repoPath, ['branch', '--list', branch])
  if (branches.trim() === '') {
    await git(repoPath, ['checkout', '-q', '-b', branch])
  } else {
    await git(repoPath, ['checkout', '-q', branch])
  }
  return branch
}

export interface DiffSummary {
  statText: string
  filesChanged: string[]
}

/** Summarizes uncommitted changes in the workspace for the ClickUp comment (not the full patch). */
export async function diffSummary(repoPath: string): Promise<DiffSummary> {
  await git(repoPath, ['add', '-A'])
  const statText = await git(repoPath, ['diff', '--cached', '--stat'])
  const nameOnly = await git(repoPath, ['diff', '--cached', '--name-only'])
  return { statText, filesChanged: nameOnly.split('\n').filter(Boolean) }
}

export async function commitWorkspace(repoPath: string, message: string): Promise<void> {
  await git(repoPath, ['add', '-A'])
  await git(repoPath, ['commit', '-q', '-m', message, '--allow-empty'])
}

import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = `${dir}/${entry.name}`
    return entry.isDirectory() ? walk(path) : [path]
  })
}

describe('no call site ever builds --allow-live', () => {
  it('the literal string --allow-live appears only in the policy denylist, never as a real CLI arg', () => {
    const offenders: string[] = []
    for (const file of walk('src').filter((f) => f.endsWith('.ts'))) {
      const content = readFileSync(file, 'utf8')
      if (content.includes('--allow-live') && file !== 'src/policy.ts') {
        offenders.push(file)
      }
    }
    expect(offenders).toEqual([])
  })

  it('theme.ts push functions never pass --live (which would target the live theme)', () => {
    const content = readFileSync('src/shopify/theme.ts', 'utf8')
    const pushFns = content.split(/(?=export async function push)/).filter((c) => c.startsWith('export async function push'))
    for (const fn of pushFns) {
      expect(fn.includes("'--live'")).toBe(false)
    }
  })
})

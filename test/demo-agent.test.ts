import { describe, it, expect } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runDemoThemeAgent, runDemoAdminAgent } from '../src/agent/demo-agent.js'

function workspace(): string {
  const dir = mkdtempSync(join(tmpdir(), 'demo-agent-'))
  mkdirSync(join(dir, 'sections'))
  writeFileSync(join(dir, 'sections/header-group.json'), '/* c */\n{"text": "Welcome to our store", "case": "none", "speed": 5}')
  return dir
}
const base = { taskTitle: 'Holiday bar', taskDescription: 'Free gift wrapping through Dec 24. Match brand.', model: 'x', brandFilePath: '', priorComments: [] as string[] }

describe('demo theme agent', () => {
  it('sets the announcement text from the description', async () => {
    const dir = workspace()
    const r = await runDemoThemeAgent({ ...base, workspaceDir: dir })
    expect(readFileSync(join(dir, 'sections/header-group.json'), 'utf8')).toContain('"text": "Free gift wrapping through Dec 24"')
    expect(r.filesChanged).toEqual(['sections/header-group.json'])
  })
  it('applies a revision comment', async () => {
    const dir = workspace()
    await runDemoThemeAgent({ ...base, workspaceDir: dir, priorComments: ['make it uppercase and faster'] })
    const f = readFileSync(join(dir, 'sections/header-group.json'), 'utf8')
    expect(f).toContain('"case": "uppercase"')
    expect(f).toContain('"speed": 8')
  })
})

describe('demo admin agent', () => {
  it('plans tags for products under the price cap plus one collection', async () => {
    const adminClient = {
      listProductsUnderPrice: async (max: number) => (max === 100 ? [{ id: 'gid://1', title: 'Tote', price: 38 }] : []),
      getCollections: async () => [],
    }
    const plan = await runDemoAdminAgent({
      taskTitle: 'Tag holiday gifts',
      taskDescription: "Tag every product under $100 'Holiday Gift' and create a 'Holiday Gifts' collection.",
      priorComments: [], runsDir: '', model: 'x', adminClient: adminClient as never,
    })
    expect(plan.mutations.map((m) => m.op)).toEqual(['tagsAdd', 'collectionCreate'])
    expect(plan.mutations[1]).toMatchObject({ target: 'Holiday Gifts', input: { tag: 'Holiday Gift' } })
    expect(plan.affectedCount).toBe(1)
  })
})

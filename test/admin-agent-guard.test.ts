import { describe, it, expect } from 'vitest'
import { makeAdminCanUseTool } from '../src/agent/admin-agent.js'

const runsDir = '/app/runs/task123'

describe('makeAdminCanUseTool', () => {
  it('allows the read-only MCP tools', async () => {
    const canUseTool = makeAdminCanUseTool(runsDir)
    const result = await canUseTool('mcp__storeloop-admin-read__listProducts', { query: 'tag:x' }, {} as never)
    expect(result.behavior).toBe('allow')
  })

  it('allows Write inside runs/<taskId>/', async () => {
    const canUseTool = makeAdminCanUseTool(runsDir)
    const result = await canUseTool('Write', { file_path: `${runsDir}/plan.json`, content: '{}' }, {} as never)
    expect(result.behavior).toBe('allow')
  })

  it('denies Write outside runs/<taskId>/', async () => {
    const canUseTool = makeAdminCanUseTool(runsDir)
    const result = await canUseTool('Write', { file_path: '/app/src/env.ts', content: 'x' }, {} as never)
    expect(result.behavior).toBe('deny')
  })

  it('denies Bash entirely', async () => {
    const canUseTool = makeAdminCanUseTool(runsDir)
    const result = await canUseTool('Bash', { command: 'ls' }, {} as never)
    expect(result.behavior).toBe('deny')
  })

  it('denies Edit (no file edits, only writes under runs/)', async () => {
    const canUseTool = makeAdminCanUseTool(runsDir)
    const result = await canUseTool('Edit', { file_path: `${runsDir}/plan.json` }, {} as never)
    expect(result.behavior).toBe('deny')
  })
})

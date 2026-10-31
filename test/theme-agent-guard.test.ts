import { describe, it, expect, vi } from 'vitest'
import { makeCanUseTool } from '../src/agent/theme-agent.js'

const root = '/workspaces/client/theme'

describe('makeCanUseTool', () => {
  it('denies a Bash command matching the policy denylist and reports it', async () => {
    const onDenied = vi.fn()
    const canUseTool = makeCanUseTool(root, onDenied)
    const result = await canUseTool('Bash', { command: 'shopify theme publish --theme 1' }, {} as never)
    expect(result.behavior).toBe('deny')
    expect(onDenied).toHaveBeenCalledWith(
      expect.objectContaining({ toolName: 'Bash', reason: expect.stringContaining('publish') }),
    )
  })

  it('allows a safe Bash command', async () => {
    const canUseTool = makeCanUseTool(root, vi.fn())
    const result = await canUseTool('Bash', { command: 'shopify theme check' }, {} as never)
    expect(result.behavior).toBe('allow')
  })

  it('allows the base file tools', async () => {
    const canUseTool = makeCanUseTool(root, vi.fn())
    for (const tool of ['Read', 'Edit', 'Write', 'Glob', 'Grep']) {
      const result = await canUseTool(tool, {}, {} as never)
      expect(result.behavior).toBe('allow')
    }
  })

  it('allows Shopify Dev MCP tools', async () => {
    const canUseTool = makeCanUseTool(root, vi.fn())
    const result = await canUseTool('mcp__shopify-dev-mcp__validate_theme_codeblocks', {}, {} as never)
    expect(result.behavior).toBe('allow')
  })

  it('denies anything else by default', async () => {
    const onDenied = vi.fn()
    const canUseTool = makeCanUseTool(root, onDenied)
    const result = await canUseTool('WebFetch', {}, {} as never)
    expect(result.behavior).toBe('deny')
    expect(onDenied).toHaveBeenCalled()
  })
})

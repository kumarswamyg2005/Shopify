import { describe, it, expect } from 'vitest'
import { adminPlanMutationSchema } from '../src/agent/admin-agent.js'

describe('adminPlanMutationSchema', () => {
  it('accepts an allow-listed op', () => {
    const result = adminPlanMutationSchema.safeParse({ op: 'tagsAdd', target: 'gid://shopify/Product/1', input: { tags: ['Holiday Gift'] } })
    expect(result.success).toBe(true)
  })

  it('rejects a destructive op — the agent cannot even construct one', () => {
    const result = adminPlanMutationSchema.safeParse({ op: 'productDelete', target: 'gid://shopify/Product/1', input: {} })
    expect(result.success).toBe(false)
  })

  it('rejects an unknown op', () => {
    const result = adminPlanMutationSchema.safeParse({ op: 'somethingMadeUp', target: 'x', input: {} })
    expect(result.success).toBe(false)
  })
})

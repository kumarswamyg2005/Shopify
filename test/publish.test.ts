import { describe, it, expect, vi } from 'vitest'

const getLiveThemeId = vi.fn()
const publishTheme = vi.fn()
vi.mock('../src/shopify/theme.js', () => ({ getLiveThemeId, publishTheme }))

const { publishApprovedTheme, PlanHashMismatchError } = await import('../src/shopify/publish.js')

const config = { store: 'x.myshopify.com', themeToken: 't' }
const baseTaskState = {
  clickupTaskId: 'task_1',
  clientId: 'storeloop-demo',
  type: 'theme' as const,
  unpublishedThemeId: 'SL-1',
  branch: 'task/task_1',
  round: 1,
  status: 'approved',
  approvedPlanHash: 'hash-a',
  lastCommentId: null,
}

describe('publishApprovedTheme', () => {
  it('refuses when no plan hash was captured at enqueue time', async () => {
    await expect(publishApprovedTheme(config, baseTaskState, null)).rejects.toThrow(PlanHashMismatchError)
    expect(publishTheme).not.toHaveBeenCalled()
  })

  it('refuses when the job plan hash does not match the current approved plan hash (stale revision)', async () => {
    await expect(publishApprovedTheme(config, baseTaskState, 'hash-stale')).rejects.toThrow(PlanHashMismatchError)
    expect(publishTheme).not.toHaveBeenCalled()
  })

  it('refuses when there is no unpublished theme recorded', async () => {
    await expect(publishApprovedTheme(config, { ...baseTaskState, unpublishedThemeId: null }, 'hash-a')).rejects.toThrow()
    expect(publishTheme).not.toHaveBeenCalled()
  })

  it('publishes when the plan hash matches, recording the previous live theme for rollback', async () => {
    getLiveThemeId.mockResolvedValue('OLD-123')
    publishTheme.mockResolvedValue(undefined)
    const result = await publishApprovedTheme(config, baseTaskState, 'hash-a')
    expect(result).toEqual({ publishedThemeId: 'SL-1', previousLiveThemeId: 'OLD-123' })
    expect(publishTheme).toHaveBeenCalledWith(config, 'SL-1')
  })
})

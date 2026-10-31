import { describe, it, expect, vi, beforeEach } from 'vitest'

const execaMock = vi.fn()
vi.mock('execa', () => ({ execa: (...args: unknown[]) => execaMock(...args) }))

const { pushUnpublished, themeCheck, ThemeCheckFailedError, ThemePushFailedError } = await import('../src/shopify/theme.js')

const config = { store: 'storeloop-demo.myshopify.com', themeToken: 'test-token' }

beforeEach(() => {
  execaMock.mockReset()
})

describe('pushUnpublished', () => {
  it('parses the real CLI JSON shape (theme.id, theme.previewUrl)', async () => {
    execaMock.mockResolvedValue({
      stdout: JSON.stringify({
        status: 'success',
        theme: { id: '190318739751', name: 'SL-1', role: 'unpublished', previewUrl: 'https://x?preview_theme_id=190318739751' },
      }),
    })
    const result = await pushUnpublished(config, '/workspace', 'SL-1')
    expect(result).toEqual({ themeId: '190318739751', previewUrl: 'https://x?preview_theme_id=190318739751' })
  })

  it('falls back to a constructed preview url if the CLI omits previewUrl', async () => {
    execaMock.mockResolvedValue({
      stdout: JSON.stringify({ status: 'success', theme: { id: '123', name: 'SL-1', role: 'unpublished' } }),
    })
    const result = await pushUnpublished(config, '/workspace', 'SL-1')
    expect(result.previewUrl).toContain('preview_theme_id=123')
  })

  it('throws if the CLI prints no JSON at all', async () => {
    execaMock.mockResolvedValue({ stdout: 'not json' })
    await expect(pushUnpublished(config, '/workspace', 'SL-1')).rejects.toThrow(ThemePushFailedError)
  })
})

describe('themeCheck', () => {
  it('returns issues when the CLI reports valid: true', async () => {
    execaMock.mockResolvedValue({
      exitCode: 0,
      stdout: JSON.stringify({
        valid: true,
        issues: [{ filePath: 'a.liquid', check: 'UnusedAssign', severity: 'warning', message: 'unused' }],
      }),
    })
    const issues = await themeCheck('/workspace')
    expect(issues).toHaveLength(1)
  })

  it('throws ThemeCheckFailedError when the CLI reports valid: false', async () => {
    execaMock.mockResolvedValue({
      exitCode: 1,
      stdout: JSON.stringify({
        valid: false,
        issues: [{ filePath: 'a.liquid', check: 'ValidSchema', severity: 'error', message: 'bad schema' }],
      }),
    })
    await expect(themeCheck('/workspace')).rejects.toThrow(ThemeCheckFailedError)
  })
})

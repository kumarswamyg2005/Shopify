import { describe, it, expect } from 'vitest'
import { renderThemeReviewComment } from '../src/clickup/comment-template.js'

describe('renderThemeReviewComment', () => {
  it('matches the DESIGN.md PART B template', () => {
    const comment = renderThemeReviewComment({
      round: 2,
      taskTitle: 'Holiday announcement bar',
      summary: 'Added announcement-bar block with countdown to Dec 1, 00:00 store time',
      previewThemeId: 'SL-86b1x2',
      previewUrl: 'https://storeloop-demo.myshopify.com?preview_theme_id=123',
      filesChanged: ['sections/header-group.json', 'blocks/countdown.liquid', 'assets/countdown.js'],
      insertions: 64,
      deletions: 2,
      themeCheckErrorCount: 0,
      lighthouseBefore: 71,
      lighthouseAfter: 70,
      assumptions: ['countdown hides itself after the deadline'],
      questionsForHuman: [],
      screenshotFilenames: ['desktop-before.png', 'desktop-after.png', 'mobile-before.png', 'mobile-after.png'],
      agentTimeMs: 4 * 60_000 + 12_000,
    })
    expect(comment).toMatchInlineSnapshot(`
      "[StoreLoop] Round 2 ready for review — Holiday announcement bar

      What changed
      - Added announcement-bar block with countdown to Dec 1, 00:00 store time

      Preview (unpublished theme SL-86b1x2): https://storeloop-demo.myshopify.com?preview_theme_id=123
      Files: 3 changed (+64 −2) — sections/header-group.json, blocks/countdown.liquid, assets/countdown.js
      Checks: theme check 0 errors · Lighthouse mobile 71 → 70 (-1)
      Assumptions: countdown hides itself after the deadline
      Questions: none
      Screenshots: desktop-before.png, desktop-after.png, mobile-before.png, mobile-after.png (attached)

      Next: comment to revise · move to "approved" to publish · live theme is untouched until then
      Agent time: 4m 12s (logged)"
    `)
  })

  it('starts with the [StoreLoop] prefix so StoreLoop never re-triggers itself on its own comments', () => {
    const comment = renderThemeReviewComment({
      round: 1,
      taskTitle: 'x',
      summary: 'x',
      previewThemeId: 'SL-1',
      previewUrl: 'https://x',
      filesChanged: [],
      insertions: 0,
      deletions: 0,
      themeCheckErrorCount: 0,
      lighthouseBefore: 80,
      lighthouseAfter: 80,
      assumptions: [],
      questionsForHuman: [],
      screenshotFilenames: [],
      agentTimeMs: 0,
    })
    expect(comment.startsWith('[StoreLoop]')).toBe(true)
  })
})

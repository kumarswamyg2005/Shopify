import type { BrowserContext, Page } from 'playwright'
import { env } from '../env.js'

/** Dev stores can't turn their storefront password off; if STOREFRONT_PASSWORD is set, enter it so previews render. */
export async function unlockStorefront(page: Page, url: string): Promise<void> {
  await page.goto(url, { waitUntil: 'load', timeout: 30_000 })
  if (!env.STOREFRONT_PASSWORD || !new URL(page.url()).pathname.startsWith('/password')) return
  await page.fill('input[type=password]', env.STOREFRONT_PASSWORD)
  await page.keyboard.press('Enter')
  await page.waitForLoadState('load')
  await page.goto(url, { waitUntil: 'load', timeout: 30_000 })
}

export async function cookieHeader(context: BrowserContext): Promise<string> {
  return (await context.cookies()).map((c) => `${c.name}=${c.value}`).join('; ')
}

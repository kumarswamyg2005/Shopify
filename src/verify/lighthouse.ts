import lighthouse from 'lighthouse'
import * as chromeLauncher from 'chrome-launcher'
import { chromium } from 'playwright'
import { cookieHeader, unlockStorefront } from './unlock.js'

export interface LighthouseResult {
  performanceScore: number
}

/** Runs a single mobile-preset Lighthouse performance pass against `url`. */
export async function runLighthouse(url: string): Promise<LighthouseResult> {
  const browser = await chromium.launch()
  let cookie = ''
  try {
    const context = await browser.newContext()
    await unlockStorefront(await context.newPage(), url)
    cookie = await cookieHeader(context)
  } finally {
    await browser.close()
  }
  const chrome = await chromeLauncher.launch({ chromeFlags: ['--headless'] })
  try {
    const result = await lighthouse(url, {
      port: chrome.port,
      extraHeaders: cookie ? { Cookie: cookie } : {},
      onlyCategories: ['performance'],
      formFactor: 'mobile',
      screenEmulation: { mobile: true, width: 390, height: 844, deviceScaleFactor: 2, disabled: false },
    })
    const score = result?.lhr.categories.performance?.score
    if (score == null) throw new Error('lighthouse did not return a performance score')
    return { performanceScore: Math.round(score * 100) }
  } finally {
    await chrome.kill()
  }
}

import lighthouse from 'lighthouse'
import * as chromeLauncher from 'chrome-launcher'

export interface LighthouseResult {
  performanceScore: number
}

/** Runs a single mobile-preset Lighthouse performance pass against `url`. */
export async function runLighthouse(url: string): Promise<LighthouseResult> {
  const chrome = await chromeLauncher.launch({ chromeFlags: ['--headless'] })
  try {
    const result = await lighthouse(url, {
      port: chrome.port,
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

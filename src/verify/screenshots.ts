import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'

const VIEWPORTS = {
  desktop: { width: 1440, height: 900 },
  mobile: { width: 390, height: 844 },
} as const

export interface Screenshots {
  desktop: string
  mobile: string
}

/** Captures desktop + mobile screenshots of `url` into `outDir`, named `<prefix>-<viewport>.png`. */
export async function captureScreenshots(url: string, outDir: string, prefix: string): Promise<Screenshots> {
  mkdirSync(outDir, { recursive: true })
  const browser = await chromium.launch()
  try {
    const paths: Partial<Screenshots> = {}
    for (const [name, viewport] of Object.entries(VIEWPORTS) as Array<[keyof Screenshots, { width: number; height: number }]>) {
      const page = await browser.newPage({ viewport })
      await page.goto(url, { waitUntil: 'load', timeout: 30_000 })
      const path = `${outDir}/${prefix}-${name}.png`
      await page.screenshot({ path, fullPage: false })
      await page.close()
      paths[name] = path
    }
    return paths as Screenshots
  } finally {
    await browser.close()
  }
}

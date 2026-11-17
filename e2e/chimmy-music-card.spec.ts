import { expect, test } from '@playwright/test'
import { answerCspReportsInBrowser } from './helpers/csp-report-sink'

/*
 * Chimmy's music cards (2026-11-16) in a real browser, against a stand-in music engine that records
 * what it was asked to do: nothing plays before a tap; each tap asks the engine for exactly one thing.
 */

test.beforeEach(async ({ context }) => {
  await answerCspReportsInBrowser(context)
})

for (const viewport of [
  { name: 'desktop', width: 1280, height: 900 },
  { name: 'phone', width: 390, height: 844 },
]) {
  test(`${viewport.name}: a station, a search and stop, each only on a tap`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height })
    await page.route('**/api/music/youtube-search**', (route) =>
      route.fulfill({ json: { status: 'ok', results: [{ videoId: 'abcdefghijk', title: 'Drake – Started From the Bottom', channel: 'Drake', thumb: null }] } }),
    )
    await page.goto('/e2e/chimmy-music-card')
    const cards = page.getByTestId('chimmy-music-card')
    await expect(cards).toHaveCount(3)
    await expect(page.getByTestId('music-engine-log').locator('li')).toHaveCount(0)
    await page.screenshot({ path: testInfo.outputPath(`${viewport.name}-music-cards.png`), fullPage: true })

    await cards.nth(0).getByTestId('chimmy-music-play').click()
    await cards.nth(1).getByTestId('chimmy-music-play').click()
    await expect(cards.nth(1).getByTestId('chimmy-music-note')).toHaveText('Playing Drake – Started From the Bottom.')
    await cards.nth(2).getByTestId('chimmy-music-play').click()
    await expect(page.getByTestId('music-engine-log').locator('li')).toHaveText([
      'play game-day — Game day hype',
      'play search:abcdefghijk — Drake – Started From the Bottom',
      'stop',
    ])
    await page.screenshot({ path: testInfo.outputPath(`${viewport.name}-music-played.png`), fullPage: true })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  })
}

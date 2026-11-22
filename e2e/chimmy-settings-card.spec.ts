import { expect, test } from '@playwright/test'
import { answerCspReportsInBrowser } from './helpers/csp-report-sink'

/*
 * Chimmy's league-settings confirm card (stage 5, 2026-11-16) in a real browser: each setting before →
 * after; one tap saves; mid-season the first tap sends nothing and the second one saves.
 */

test.beforeEach(async ({ context }) => {
  await answerCspReportsInBrowser(context)
})

async function open(page: import('@playwright/test').Page) {
  const sent: string[] = []
  await page.route('**/api/chimmy/actions/confirm', async (route) => {
    const body = JSON.parse(route.request().postData() ?? '{}') as { token?: string }
    sent.push(String(body.token))
    await route.fulfill({ json: { ok: true, status: 'executed', kind: 'settings', message: 'Saved — the settings are changed.' } })
  })
  await page.goto('/e2e/chimmy-settings-card')
  await expect(page.getByTestId('settings-card-preseason')).toBeVisible()
  return sent
}

for (const viewport of [
  { name: 'desktop', width: 1280, height: 900 },
  { name: 'phone', width: 390, height: 844 },
]) {
  test(`${viewport.name}: before → after, one tap, and the mid-season second tap`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height })
    const sent = await open(page)
    const pre = page.getByTestId('settings-card-preseason')
    const mid = page.getByTestId('settings-card-mid-season')
    await expect(pre.getByTestId('chimmy-action-settings')).toContainText('FAAB budget: $100 → $200')
    await expect(mid.getByTestId('chimmy-action-warnings')).toContainText('The season has started')
    await page.screenshot({ path: testInfo.outputPath(`${viewport.name}-settings-cards.png`), fullPage: true })

    await mid.getByTestId('chimmy-action-confirm').click()
    expect(sent).toEqual([])
    await expect(mid.getByTestId('chimmy-action-second-tap')).toContainText('Tap again')
    await expect(mid.getByTestId('chimmy-action-confirm')).toHaveText('Yes — change it mid-season')
    await page.screenshot({ path: testInfo.outputPath(`${viewport.name}-mid-season-armed.png`), fullPage: true })
    await mid.getByTestId('chimmy-action-confirm').click()
    await expect(mid.getByRole('status')).toContainText('Saved')
    expect(sent).toHaveLength(1)

    await pre.getByTestId('chimmy-action-confirm').click()
    await expect(pre.getByRole('status')).toContainText('Saved')
    expect(sent).toHaveLength(2)
    await page.screenshot({ path: testInfo.outputPath(`${viewport.name}-settings-saved.png`), fullPage: true })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  })
}

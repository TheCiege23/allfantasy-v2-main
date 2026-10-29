import { expect, test } from '@playwright/test'

test('league display choices save, survive reload, and leave draft entry tappable', async ({ page }, testInfo) => {
  let preferences: Record<string, unknown> = { categories: { draft_alerts: { enabled: true } } }
  await page.route('**/api/user/profile', async route => {
    if (route.request().method() === 'PATCH') {
      preferences = { ...preferences, ...route.request().postDataJSON().notificationPreferences }
    }
    await route.fulfill({ json: { profile: { notificationPreferences: preferences } } })
  })
  await page.route('**/api/leagues/layout-preview/**', route => route.fulfill({ json: {} }))
  await page.goto('/dev/league-layout-preview')
  const chat = page.getByRole('switch', { name: /Chat & Chimmy/ })
  await expect(chat).toBeChecked({ timeout: 60_000 })
  // The entire row is the touch target, including the descriptive copy.
  await page.locator('[data-league-section="chat"]').tap()
  await page.locator('[data-league-section="standings"]').tap()
  await expect(page.getByRole('status')).toHaveText(/Saved/)
  await page.reload()
  await expect(chat).not.toBeChecked()
  await page.getByRole('button', { name: 'league', exact: true }).tap()
  await expect(page.getByRole('button', { name: 'Open league chat' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Full table' })).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'Customize page' })).toBeVisible()
  const draft = page.getByRole('button', { name: /Enter Draft HQ/ })
  await expect(draft).toBeVisible()
  const box = await draft.boundingBox()
  expect(box!.height).toBeGreaterThanOrEqual(44)
  await draft.tap()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.getByRole('button', { name: 'settings', exact: true }).tap()
  await page.getByRole('button', { name: 'Show everything' }).tap()
  await expect(chat).toBeChecked()
  await page.getByRole('button', { name: 'home', exact: true }).tap()
  await expect(page.locator('[data-home-section="drafts"] input')).not.toBeChecked()
  await expect(page.locator('[data-home-section="streak"] input')).toBeChecked()
  expect(preferences.categories).toEqual({ draft_alerts: { enabled: true } })
  await testInfo.attach('layout-settings', { body: await page.screenshot(), contentType: 'image/png' })
})

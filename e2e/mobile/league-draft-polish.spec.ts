import { expect, test } from '@playwright/test'

/*
 * 🛑 NO REQUEST FROM THESE PREVIEW PAGES REACHES THE DEV SERVER'S API ROUTES.
 *
 * The league home screen fires seven API requests on load — /api/league/chat, /api/shared/activity,
 * /api/i18n/translations, the league's activity, rules-explainer and nfl-scoring, /api/chat/unread — and
 * nothing here waits for them. The first test finished in ~5s and closed, but `next dev` went on compiling
 * whichever route was cold: /api/league/chat is 10,805 modules (85s, measured locally), /api/i18n/translations
 * 12,207 (80.7s). The next test's page request queued behind that compile. So the draft test's first attempt
 * took 52-67s in EVERY one of 15 mobile-smoke runs (2026-11-20), failing at the 60s timeout in 10 of them on
 * `page.goto` (ERR_ABORTED / timeout) or mid-test, and passing on retry in 3-30s once the compile was done.
 * The Safari pass paid it again after the dev server's mid-run memory restart.
 *
 * Each is answered here with what it returns to a signed-out visitor, which is what this preview is
 * (measured with curl against the dev server): 401 `{ error: 'Unauthorized' }`, except /api/shared/activity,
 * which is 200 with no items. /api/i18n/translations returns 200 signed out; a 401 instead makes
 * LanguageProviderClient keep the bundled English copy it already rendered, which is its designed fallback.
 * A test's own `page.route` registered later still wins, as /api/chat/unread's does below.
 */
test.beforeEach(async ({ page }) => {
  await page.route('**/api/**', (route) => {
    const { pathname } = new URL(route.request().url())
    if (pathname === '/api/shared/activity') return route.fulfill({ status: 200, json: { status: 'ok', items: [] } })
    return route.fulfill({ status: 401, json: { error: 'Unauthorized' } })
  })
})

test('league section picker and switcher stay tappable through rotation', async ({ page }, testInfo) => {
  await page.route('**/api/chat/unread', route => route.fulfill({ json: { byLeague: {} } }))
  await page.goto('/dev/league-mobile-preview')
  const section = page.getByRole('combobox', { name: 'League section', exact: true })
  await expect(section).toBeVisible({ timeout: 60_000 })
  await section.selectOption('roster')
  await expect(page.getByRole('heading', { name: 'roster', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Sunday Night Dynasty, switch league' }).tap()
  await expect(page.getByRole('dialog', { name: 'Switch league' })).toBeVisible()
  await page.getByRole('button', { name: 'Close league switcher' }).tap()
  await page.getByRole('button', { name: 'Open league navigation' }).tap()
  const original = page.viewportSize()!
  await page.setViewportSize({ width: 900, height: 420 })
  await expect(page.locator('.nl-menu-open')).toHaveCount(0)
  await page.setViewportSize(original)
  await expect(page.getByRole('button', { name: 'Open league navigation' })).toHaveAttribute('aria-expanded', 'false')
  await section.selectOption('draft')
  await expect(page.getByRole('heading', { name: 'draft', exact: true })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await section.selectOption('native_home')
  await testInfo.attach('league-mobile', { body: await page.screenshot(), contentType: 'image/png' })
})

test('draft tools, player search and options work on narrow and short screens', async ({ page }, testInfo) => {
  await page.goto('/dev/league-mobile-preview?screen=draft')
  const more = page.getByTestId('draft-mobile-more')
  await expect(more).toBeVisible({ timeout: 60_000 })
  await expect(page.getByTestId('draft-mobile-quick-dock')).toHaveCount(0)
  const floating = await page.getByTestId('war-room-popup-trigger').boundingBox()
  const nav = await page.getByTestId('draft-mobile-primary-nav').boundingBox()
  expect(floating!.y + floating!.height).toBeLessThan(nav!.y)
  await more.tap()
  await expect(page.getByTestId('war-room-popup-trigger')).toBeHidden()
  await page.getByTestId('draft-mobile-tab-roster').tap()
  await expect(page.getByTestId('draft-mobile-content')).toHaveAttribute('data-active-tab', 'roster')
  await expect(page.getByTestId('draft-mobile-quick-dock')).toHaveCount(0)
  await page.getByTestId('draft-mobile-tab-players').tap()
  const search = page.getByRole('textbox', { name: 'Search players' })
  await search.fill('Justin')
  expect(await search.evaluate(el => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(16)
  for (const id of ['draft-back-button', 'draft-topbar-menu-toggle', 'draft-mobile-more', 'draft-mobile-tab-players']) {
    const box = await page.getByTestId(id).boundingBox()
    expect(box!.width).toBeGreaterThanOrEqual(44)
    expect(box!.height).toBeGreaterThanOrEqual(44)
  }
  await page.setViewportSize({ width: 667, height: 375 })
  await page.getByTestId('draft-topbar-menu-toggle').tap()
  const menu = page.getByTestId('draft-topbar-menu')
  await expect(menu).toBeVisible()
  const box = await menu.boundingBox()
  expect(box!.y + box!.height).toBeLessThanOrEqual(375)
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(menu).toHaveCount(0)
  await page.getByTestId('draft-mobile-tab-chat').tap()
  await page.getByRole('textbox', { name: 'Message', exact: true }).fill('Ready for draft day')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.getByTestId('draft-mobile-tab-board').tap()
  await expect(page.getByTestId('draft-mobile-content')).toHaveAttribute('data-active-tab', 'board')
  // Paused commissioners resume from the one Resume pill; the clock only reads Paused (2026-11-19),
  // and it must still fit beside the team.
  const timer = page.getByTestId('draft-topbar-clock')
  expect(await timer.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
  await page.getByTestId('draft-mobile-tab-players').tap()
  await testInfo.attach('draft-mobile', { body: await page.screenshot(), contentType: 'image/png' })
})

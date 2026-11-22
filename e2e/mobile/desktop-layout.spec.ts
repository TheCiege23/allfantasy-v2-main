import { test, expect } from '@playwright/test'

const sizes = [
  { width: 1920, height: 1080 },
  { width: 1440, height: 900 },
  { width: 1366, height: 768 },
  { width: 1280, height: 720 },
  { width: 1093, height: 614 },
  { width: 960, height: 540 },
]

test('desktop navigation dropdown items are visible and receive pointer clicks', async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL, hasTouch: false, isMobile: false })
  try {
    const page = await context.newPage()
    await page.goto('/dev/league-mobile-preview?screen=navigation')
    for (const size of sizes.filter(size => size.width >= 1024)) {
      await page.setViewportSize(size)
      for (const group of ['play', 'hubs', 'you']) {
        const opener = page.getByTestId(`global-nav-group-${group}`)
        await opener.click()
        const menu = page.getByTestId(`global-nav-menu-${group}`)
        await expect(menu).toBeVisible()
        for (const item of await menu.getByRole('menuitem').all()) {
          // Visibility alone does not detect overflow clipping. A trial click
          // checks hit testing without navigating or mutating user data.
          await item.click({ trial: true, timeout: 5000 })
        }
        await opener.click()
        await expect(menu).toBeHidden()
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(size.width)
    }
  } finally { await context.close() }
})

test('Chimmy uses one header and retains language selection on laptops', async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL, hasTouch: false, isMobile: false })
  try {
    const page = await context.newPage()
    await page.goto('/chimmy')
    for (const size of sizes) {
      await page.setViewportSize(size)
      await expect(page.locator('header')).toHaveCount(1)
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
      await expect(page.getByTestId('language-toggle-compact').getByRole('combobox')).toBeVisible()
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(size.width)
    }
  } finally { await context.close() }
})

test('support and imported league confirmation remain reachable on short laptops', async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL, hasTouch: false, isMobile: false })
  try {
    const page = await context.newPage()
    await page.goto('/dev/league-mobile-preview?screen=support')
    for (const size of sizes.slice(2)) {
      await page.setViewportSize(size)
      for (const surface of ['core', 'global']) {
        const opener = surface === 'core'
          ? page.getByRole('button', { name: 'Preview core support', exact: true })
          : page.getByTestId('open-support-widget')
        await opener.click()
        const dialog = page.getByRole('dialog', { name: surface === 'core' ? 'Contact support' : 'Contact AllFantasy Support', exact: true })
        const box = await dialog.boundingBox()
        expect(box!.y).toBeGreaterThanOrEqual(0)
        expect(box!.y + box!.height).toBeLessThanOrEqual(size.height + 1)
        await dialog.locator('input[type=email]').fill('layout-check@example.com')
        await dialog.locator('textarea').first().fill('Layout verification only. This message is never submitted.')
        const send = dialog.getByRole('button', { name: surface === 'core' ? 'Send it' : 'Send message', exact: true })
        await send.scrollIntoViewIfNeeded()
        await send.click({ trial: true })
        const close = dialog.getByRole('button', { name: surface === 'core' ? 'Close' : 'Close support form', exact: true })
        await close.scrollIntoViewIfNeeded()
        await close.click()
        await expect(dialog).toBeHidden()
      }
      await page.getByTestId('delete-imported-league-open').click()
      const dialog = page.getByRole('dialog', { name: 'Delete this imported league?', exact: true })
      await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
      await expect(dialog).toBeHidden()
    }
  } finally { await context.close() }
})

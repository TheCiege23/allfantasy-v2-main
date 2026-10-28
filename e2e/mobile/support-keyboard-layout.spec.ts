import { test, expect, type Page } from '@playwright/test'

// Simulates Android's resizes-visual keyboard while preserving the layout viewport.
// Merely making page.setViewportSize shorter would miss the original defect.
async function installVisualViewport(page: Page) {
  await page.addInitScript(() => {
    const viewport = new EventTarget()
    Object.assign(viewport, { height: innerHeight, offsetTop: 0, scale: 1 })
    Object.defineProperty(window, 'visualViewport', { configurable: true, value: viewport })
  })
}

async function keyboard(page: Page, height: number, offsetTop = 0, scale = 1) {
  await page.evaluate(({ height, offsetTop, scale }) => {
    Object.assign(window.visualViewport!, { height, offsetTop, scale })
    window.visualViewport!.dispatchEvent(new Event('resize'))
    window.visualViewport!.dispatchEvent(new Event('scroll'))
  }, { height, offsetTop, scale })
}

test('selected league tab stays visible on arrival and after rotation', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 })
  await page.goto('/dev/league-mobile-preview?screen=support')
  const row = page.getByTestId('mobile-support-preview').locator('.af-lt-compact-row')
  await expect(row.locator('[aria-current="page"]')).toHaveText('Moves')
  for (const size of [{ width: 360, height: 800 }, { width: 844, height: 390 }, { width: 320, height: 640 }]) {
    await page.setViewportSize(size)
    await expect.poll(() => row.evaluate(el => {
      const row = el.getBoundingClientRect()
      const tab = el.querySelector('[aria-current="page"]')!.getBoundingClientRect()
      return tab.left >= row.left - 1 && tab.right <= row.right + 1
    })).toBe(true)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  }
})

for (const size of [{ width: 320, height: 640 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) {
  for (const surface of ['core', 'global'] as const) {
    test(`${surface} support fits above the Android keyboard at ${size.width}px`, async ({ page }) => {
      await page.setViewportSize(size)
      await installVisualViewport(page)
      await page.route('**/api/legacy/feedback', route => route.fulfill({ json: { ok: true } }))
      await page.goto('/dev/league-mobile-preview?screen=support')
      const preview = page.getByTestId('mobile-support-preview')
      const opener = surface === 'core'
        ? preview.getByRole('button', { name: 'Preview core support' })
        : preview.getByTestId('open-support-widget')
      await opener.click()
      const dialog = page.getByRole('dialog', { name: surface === 'core' ? 'Contact support' : 'Contact AllFantasy Support' })
      await expect(dialog).toBeVisible()
      const close = dialog.getByRole('button', { name: surface === 'core' ? 'Close' : 'Close support form', exact: true })
      const closeBox = await close.boundingBox()
      expect(closeBox!.height).toBeGreaterThanOrEqual(44)
      expect(closeBox!.width).toBeGreaterThanOrEqual(44)
      if (surface === 'core') {
        expect((await dialog.getByRole('button', { name: "Something's broken", exact: true }).boundingBox())!.height).toBeGreaterThanOrEqual(44)
      }

      const visibleHeight = Math.min(360, size.height - 100)
      const top = 24
      await keyboard(page, visibleHeight, top)
      await expect.poll(async () => {
        const box = await dialog.boundingBox()
        return !!box && box.y >= top - 1 && box.y + box.height <= top + visibleHeight + 1
      }).toBe(true)
      await expect(dialog.locator('input[type="email"]')).toHaveValue('preview@example.com')
      await dialog.locator('textarea').first().fill('Synthetic Android layout check')
      const send = dialog.getByRole('button', { name: surface === 'core' ? 'Send it' : 'Send message', exact: true })
      await send.scrollIntoViewIfNeeded()
      const sendBox = await send.boundingBox()
      expect(sendBox!.y + sendBox!.height).toBeLessThanOrEqual(top + visibleHeight + 1)
      await send.click()
      await expect(dialog.getByRole('button', { name: 'Done', exact: true })).toBeVisible()
      await dialog.getByRole('button', { name: 'Done', exact: true }).click()
      await expect(dialog).toBeHidden()
      await expect(opener).toBeFocused()
      expect(await page.evaluate(() => document.body.style.overflow)).not.toBe('hidden')
    })
  }
}

test('delete confirmation contains focus and restores the page when cancelled', async ({ page }) => {
  await page.goto('/dev/league-mobile-preview?screen=support')
  const opener = page.getByTestId('delete-imported-league-open')
  await opener.click()
  const dialog = page.getByRole('dialog', { name: 'Delete this imported league?' })
  await expect(dialog.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused()
  expect(await page.evaluate(() => document.body.style.overflow)).toBe('hidden')
  await page.keyboard.press('Shift+Tab')
  await expect(dialog.getByTestId('delete-imported-league-confirm')).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  await expect(opener).toBeFocused()
  expect(await page.evaluate(() => document.body.style.overflow)).not.toBe('hidden')
})

test('sign-in account switch has a full touch target', async ({ page }) => {
  await page.goto('/login')
  const link = page.locator('.af-au-switch a')
  await expect(link).toBeVisible()
  expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(44)
})

test('floating support clears the theme control on phones, tablets and desktop', async ({ page }) => {
  await page.goto('/dev/league-mobile-preview?screen=support')
  const opener = page.getByTestId('mobile-support-preview').getByTestId('open-support-widget')
  const theme = page.locator('[data-af-mode-toggle]')
  await expect(theme).toBeVisible()
  for (const width of [390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 })
    const supportBox = await opener.boundingBox()
    const themeBox = await theme.boundingBox()
    const overlap = supportBox!.x < themeBox!.x + themeBox!.width &&
      supportBox!.x + supportBox!.width > themeBox!.x &&
      supportBox!.y < themeBox!.y + themeBox!.height &&
      supportBox!.y + supportBox!.height > themeBox!.y
    expect(overlap, `support and appearance controls overlap at ${width}px`).toBe(false)
    await opener.click()
    const dialog = page.getByRole('dialog', { name: 'Contact AllFantasy Support' })
    await expect(dialog).toBeVisible()
    await dialog.getByRole('button', { name: 'Close support form' }).click()
  }
})

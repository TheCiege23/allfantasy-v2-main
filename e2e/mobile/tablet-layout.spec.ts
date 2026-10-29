import { test, expect, devices, type Page } from '@playwright/test'

const tabletSizes = [
  { width: 768, height: 1024 },
  { width: 1024, height: 768 },
  { width: 1366, height: 1024 },
  { width: 600, height: 960 },
]
const tablet = (browserName: string) => devices[browserName === 'webkit' ? 'iPad Mini' : 'Galaxy Tab S4']

async function comfortableFields(page: Page, selector: string) {
  const fields = page.locator(selector)
  expect(await fields.count()).toBeGreaterThan(0)
  for (const field of await fields.all()) {
    expect(await field.evaluate(el => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(16)
    expect((await field.boundingBox())!.height).toBeGreaterThanOrEqual(44)
  }
}

test('tablet sign-in and signup fields stay readable through rotation and split view', async ({ browser, browserName, baseURL }) => {
  const context = await browser.newContext({ ...tablet(browserName), baseURL })
  try {
    const page = await context.newPage()
    for (const route of ['/login', '/signup']) {
      await page.goto(route)
      await expect(page.locator('.af-au-field input').first()).toBeVisible()
      for (const size of tabletSizes) {
        await page.setViewportSize(size)
        await comfortableFields(page, '.af-au-field input')
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(size.width)
      }
    }
  } finally { await context.close() }
})

for (const surface of ['core', 'global'] as const) {
  test(`${surface} support stays readable and usable above a tablet keyboard`, async ({ browser, browserName, baseURL }) => {
    const context = await browser.newContext({ ...tablet(browserName), baseURL })
    try {
      const page = await context.newPage()
      await page.addInitScript(() => {
        const viewport = new EventTarget()
        Object.assign(viewport, { height: innerHeight, offsetTop: 0, scale: 1 })
        Object.defineProperty(window, 'visualViewport', { configurable: true, value: viewport })
      })
      await page.goto('/dev/league-mobile-preview?screen=support')
      const preview = page.getByTestId('mobile-support-preview')
      const opener = surface === 'core'
        ? preview.getByRole('button', { name: 'Preview core support', exact: true })
        : preview.getByTestId('open-support-widget')
      for (const size of tabletSizes) {
        await page.setViewportSize(size)
        await page.evaluate(height => {
          Object.assign(window.visualViewport!, { height, offsetTop: 0 })
          window.visualViewport!.dispatchEvent(new Event('resize'))
        }, size.height)
        await opener.click()
        const dialog = page.getByRole('dialog', { name: surface === 'core' ? 'Contact support' : 'Contact AllFantasy Support', exact: true })
        await expect(dialog).toBeVisible()
        await comfortableFields(page, '[role=dialog] input[type=email], [role=dialog] textarea, [role=dialog] select')
        const height = Math.min(480, Math.floor(size.height / 2))
        const top = 36
        await page.evaluate(({ height, top }) => {
          Object.assign(window.visualViewport!, { height, offsetTop: top })
          window.visualViewport!.dispatchEvent(new Event('resize'))
          window.visualViewport!.dispatchEvent(new Event('scroll'))
        }, { height, top })
        await expect.poll(async () => {
          const box = await dialog.boundingBox()
          return !!box && box.y >= top - 1 && box.y + box.height <= top + height + 1
        }).toBe(true)
        await dialog.locator('textarea').first().fill('Tablet layout check; no message is sent')
        const send = dialog.getByRole('button', { name: surface === 'core' ? 'Send it' : 'Send message', exact: true })
        await send.scrollIntoViewIfNeeded()
        const sendBox = (await send.boundingBox())!
        expect(sendBox.height).toBeGreaterThanOrEqual(44)
        expect(sendBox.y).toBeGreaterThanOrEqual(top - 1)
        expect(sendBox.y + sendBox.height).toBeLessThanOrEqual(top + height + 1)
        const close = dialog.getByRole('button', { name: surface === 'core' ? 'Close' : 'Close support form', exact: true })
        await close.scrollIntoViewIfNeeded()
        await close.click()
        await expect(dialog).toBeHidden()
        await expect.poll(() => page.evaluate(() => document.body.style.overflow)).not.toBe('hidden')
      }
    } finally { await context.close() }
  })
}

test('tablet league navigation and delete cancellation fit after resizing', async ({ browser, browserName, baseURL }) => {
  const context = await browser.newContext({ ...tablet(browserName), baseURL })
  try {
    const page = await context.newPage()
    await page.goto('/dev/league-mobile-preview?screen=support')
    for (const size of tabletSizes) {
      await page.setViewportSize(size)
      const preview = page.getByTestId('mobile-support-preview')
      await expect(preview.locator('.af-lt-compact-row [aria-current=page]')).toHaveText('Moves')
      const more = preview.locator('.af-lt-more')
      await more.locator('summary').click()
      await expect(more).toHaveAttribute('open', '')
      const list = (await more.locator('.af-lt-more-list').boundingBox())!
      expect(list.x).toBeGreaterThanOrEqual(0)
      expect(list.x + list.width).toBeLessThanOrEqual(size.width + 1)
      await page.keyboard.press('Escape')
      await expect(more).not.toHaveAttribute('open', '')
      await page.getByTestId('delete-imported-league-open').click()
      const dialog = page.getByRole('dialog', { name: 'Delete this imported league?' })
      const box = (await dialog.boundingBox())!
      expect(box.x).toBeGreaterThanOrEqual(0)
      expect(box.x + box.width).toBeLessThanOrEqual(size.width + 1)
      const cancel = dialog.getByRole('button', { name: 'Cancel', exact: true })
      expect((await cancel.boundingBox())!.height).toBeGreaterThanOrEqual(44)
      await cancel.click()
      await expect(dialog).toBeHidden()
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(size.width)
    }
  } finally { await context.close() }
})

test('mouse desktop keeps its compact sign-in and support field typography', async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL, viewport: { width: 1440, height: 900 }, hasTouch: false, isMobile: false })
  try {
    const page = await context.newPage()
    await page.goto('/login')
    await expect(page.locator('input[name=login]')).toBeVisible()
    expect(await page.locator('input[name=login]').evaluate(el => getComputedStyle(el).fontSize)).toBe('14px')
    await page.goto('/dev/league-mobile-preview?screen=support')
    await page.getByTestId('mobile-support-preview').getByTestId('open-support-widget').click()
    const email = page.locator('#support-widget-email')
    await expect(email).toBeVisible()
    expect(await email.evaluate(el => getComputedStyle(el).fontSize)).toBe('14px')
  } finally { await context.close() }
})

import { test, expect, type Page } from '@playwright/test'

type Insets = { top: number; bottom: number; left: number; right: number }

// Headless WebKit reports zero hardware insets. Substitute only env() values
// in the rendered styles; all dialog layout rules remain the product's rules.
async function safeArea(page: Page, insets: Insets) {
  await page.evaluate(insets => {
    const apply = (style: CSSStyleDeclaration) => {
      for (const property of Array.from(style)) {
        const original = style.getPropertyValue(property)
        const value = original.replace(/env\(safe-area-inset-(top|bottom|left|right)(?:,\s*[^)]+)?\)/g,
          (_, edge: keyof Insets) => `${insets[edge]}px`)
        if (value !== original) style.setProperty(property, value, style.getPropertyPriority(property))
      }
    }
    const walk = (rules: CSSRuleList) => {
      for (const rule of Array.from(rules)) {
        if ('style' in rule) apply((rule as CSSStyleRule).style)
        if ('cssRules' in rule) walk((rule as CSSGroupingRule).cssRules)
      }
    }
    for (const sheet of Array.from(document.styleSheets)) {
      // App stylesheets are same-origin; remote font styles do not size dialogs.
      if (!sheet.href || new URL(sheet.href).origin === location.origin) walk(sheet.cssRules)
    }
    document.querySelectorAll<HTMLElement>('[style]').forEach(el => apply(el.style))
  }, insets)
}

const sizes = [
  { width: 320, height: 568, insets: { top: 20, bottom: 0, left: 0, right: 0 } },
  { width: 390, height: 844, insets: { top: 59, bottom: 34, left: 0, right: 0 } },
  { width: 844, height: 390, insets: { top: 0, bottom: 21, left: 59, right: 59 } },
]

for (const size of sizes) {
  for (const surface of ['core', 'global'] as const) {
    test(`${surface} support clears iPhone safe areas at ${size.width}px`, async ({ page }) => {
      await page.setViewportSize({ width: size.width, height: size.height })
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
      // Safari does not focus buttons on pointer clicks. Establish a focus
      // origin explicitly so the restoration assertion covers keyboard use.
      await opener.focus()
      await opener.press('Enter')
      const dialog = page.getByRole('dialog', { name: surface === 'core' ? 'Contact support' : 'Contact AllFantasy Support', exact: true })
      await expect(dialog).toBeVisible()
      await safeArea(page, size.insets)

      const fits = async (top: number, bottom: number) => {
        await expect.poll(async () => {
          const box = await dialog.boundingBox()
          return !!box && box.y >= top - 1 && box.y + box.height <= bottom + 1 &&
            box.x >= size.insets.left - 1 && box.x + box.width <= size.width - size.insets.right + 1
        }).toBe(true)
      }
      await fits(size.insets.top, size.height - size.insets.bottom)
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(size.width)
      for (const field of await dialog.locator('input[type=email], textarea, select').all()) {
        expect(await field.evaluate(el => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(16)
      }

      // Safari can pan on a scroll event alone after the keyboard's resize.
      const height = Math.min(300, size.height - 150)
      await page.evaluate(height => {
        Object.assign(window.visualViewport!, { height, offsetTop: 0 })
        window.visualViewport!.dispatchEvent(new Event('resize'))
      }, height)
      await fits(size.insets.top, height - size.insets.bottom)
      await page.evaluate(() => {
        Object.assign(window.visualViewport!, { offsetTop: 48 })
        window.visualViewport!.dispatchEvent(new Event('scroll'))
      })
      await fits(Math.max(size.insets.top, 48), 48 + height - size.insets.bottom)
      await dialog.locator('textarea').first().fill('iPhone layout check; no message is sent')
      const send = dialog.getByRole('button', { name: surface === 'core' ? 'Send it' : 'Send message', exact: true })
      await send.scrollIntoViewIfNeeded()
      const sendBox = (await send.boundingBox())!
      expect(sendBox.height).toBeGreaterThanOrEqual(44)
      expect(sendBox.y).toBeGreaterThanOrEqual(Math.max(size.insets.top, 48) - 1)
      expect(sendBox.y + sendBox.height).toBeLessThanOrEqual(48 + height - size.insets.bottom + 1)

      await page.evaluate(() => {
        Object.assign(window.visualViewport!, { height: innerHeight, offsetTop: 0 })
        window.visualViewport!.dispatchEvent(new Event('resize'))
      })
      await fits(size.insets.top, size.height - size.insets.bottom)
      const close = dialog.getByRole('button', { name: surface === 'core' ? 'Close' : 'Close support form', exact: true })
      await close.scrollIntoViewIfNeeded()
      await close.click()
      await expect(dialog).toBeHidden()
      await expect(opener).toBeFocused()
      expect(await page.evaluate(() => document.body.style.overflow)).not.toBe('hidden')
    })
  }
}

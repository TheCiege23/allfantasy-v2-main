import { expect, test } from '@playwright/test'

test.describe.configure({ timeout: 120_000 })

test.describe('@preferences universal click audit', () => {
  test('audits language, theme, timezone clicks and persistence', async ({ page }) => {
    const i18nPreferencePosts: Array<Record<string, unknown>> = []
    const profilePatchPosts: Array<Record<string, unknown>> = []

    await page.route('**/api/i18n/translations?**', async (route) => {
      const url = new URL(route.request().url())
      const lang = url.searchParams.get('lang') === 'es' ? 'es' : 'en'
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          messages:
            lang === 'es'
              ? { 'e2e.label': 'Preferencias' }
              : { 'e2e.label': 'Preferences' },
        }),
      })
    })

    await page.route('**/api/i18n/preference', async (route) => {
      if (route.request().method() === 'POST') {
        i18nPreferencePosts.push((route.request().postDataJSON() ?? {}) as Record<string, unknown>)
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true }),
      })
    })

    await page.route('**/api/user/profile', async (route) => {
      if (route.request().method() === 'PATCH') {
        profilePatchPosts.push((route.request().postDataJSON() ?? {}) as Record<string, unknown>)
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ ok: true }),
        })
        return
      }

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ preferredLanguage: null, themePreference: null, timezone: null }),
      })
    })

    await page.goto('/e2e/universal-preferences')
    await expect(page.getByRole('heading', { name: /universal preferences click audit harness/i })).toBeVisible()
    // A server-rendered button can be visible before its client handler hydrates.
    await expect.poll(async () => page.evaluate(() => window.localStorage.getItem('af_mode'))).not.toBeNull()

    await page.getByTestId('desktop-language-es').click()
    await expect.poll(async () => page.getAttribute('html', 'data-lang')).toBe('es')

    await page.getByTestId('desktop-theme-legacy').click()
    await expect.poll(async () => page.getAttribute('html', 'data-mode')).toBe('legacy')

    await page.getByTestId('desktop-timezone').selectOption('America/Chicago')
    await expect(page.getByTestId('preference-summary-timezone')).toContainText('America/Chicago')

    await page.getByTestId('mobile-theme-dark').click()
    await expect.poll(async () => page.getAttribute('html', 'data-mode')).toBe('dark')

    await page.getByTestId('save-preferences').click()
    await expect(page.getByTestId('preference-save-status')).toContainText('saved')

    expect(profilePatchPosts.length).toBeGreaterThan(0)
    expect(profilePatchPosts[0]).toMatchObject({
      preferredLanguage: 'es',
      themePreference: 'dark',
      timezone: 'America/Chicago',
    })

    expect(i18nPreferencePosts.length).toBeGreaterThan(0)
    await expect.poll(async () => page.evaluate(() => window.localStorage.getItem('af_lang'))).toBe('es')
    await expect.poll(async () => page.evaluate(() => window.localStorage.getItem('af_mode'))).toBe('dark')

    await page.reload()
    await expect(page.getByTestId('preference-summary-language')).toContainText('es')
    await expect(page.getByTestId('preference-summary-theme')).toContainText('dark')

    await page.goto('/')
    await expect.poll(async () => page.getAttribute('html', 'data-lang')).toBe('es')
    await expect.poll(async () => page.getAttribute('html', 'data-mode')).toBe('dark')
  })
})

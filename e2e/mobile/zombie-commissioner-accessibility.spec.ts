import { expect, test } from '@playwright/test'
import { installZombieLeagueE2EMocks } from '../helpers/mockZombieLeagueE2E'

test.describe('@zombie iPhone commissioner accessibility', () => {
  const leagueId = 'e2e-zombie-phone-league'

  test('keeps sections labeled, reachable, and within the phone viewport', async ({ page }) => {
    await installZombieLeagueE2EMocks(page, leagueId)
    await page.goto(`/zombie/${leagueId}`)
    await expect(page.getByRole('main').getByRole('heading', { name: 'E2E Zombie League' })).toBeVisible({ timeout: 30_000 })

    const opener = page.getByTestId('zombie-nav-commissioner')
    await opener.click()
    const dialog = page.getByRole('dialog', { name: 'Commissioner Settings' })
    await expect(dialog).toBeVisible()
    await expect(dialog).toHaveAttribute('aria-modal', 'true')

    const sections = dialog.locator('[aria-label="Commissioner settings sections"]')
    const setup = sections.getByRole('button', { name: /General/ })
    const paid = sections.getByRole('button', { name: /Free \/ Paid/ })
    await expect(setup).toBeVisible()
    await expect(paid).toBeVisible()
    const targets = await sections.getByRole('button').evaluateAll(buttons =>
      buttons.map(button => button.getBoundingClientRect().height),
    )
    expect(Math.min(...targets)).toBeGreaterThanOrEqual(44)

    await paid.click()
    await expect(dialog.getByText(/Free \/ Paid/).first()).toBeVisible()
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    expect(overflow).toBeLessThanOrEqual(1)

    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
    await expect(opener).toBeFocused()
  })
})

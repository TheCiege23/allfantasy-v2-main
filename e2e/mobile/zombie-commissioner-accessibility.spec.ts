import { expect, test } from '@playwright/test'
import { buildZombieInventoryPayload, buildZombieLeagueGetPayload, installZombieLeagueE2EMocks } from '../helpers/mockZombieLeagueE2E'

test.describe('@zombie iPhone commissioner accessibility', () => {
  const leagueId = 'e2e-zombie-phone-league'

  test('keeps sections labeled, reachable, and within the phone viewport', async ({ page }) => {
    await installZombieLeagueE2EMocks(page, leagueId)
    const overrideWrites: string[] = []
    await page.route('**/api/zombie/commissioner**', async route => {
      if (route.request().method() !== 'GET') {
        overrideWrites.push(route.request().method())
        await route.fulfill({ status: 400, json: { error: 'Viewing controls must not mutate the league.' } })
        return
      }
      await route.fulfill({ status: 200, json: { entries: [] } })
    })
    await page.goto(`/zombie/${leagueId}`)
    await expect(page.getByRole('main').getByRole('heading', { name: 'E2E Zombie League' })).toBeVisible({ timeout: 30_000 })

    const opener = page.getByTestId('zombie-mobile-ops')
    await expect(opener).toBeVisible()
    expect(await opener.evaluate(button => button.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44)
    await opener.click()
    const dialog = page.getByRole('dialog', { name: /Commissioner settings/i })
    await expect(dialog).toBeVisible()
    await expect(dialog).toHaveAttribute('aria-modal', 'true')

    const sections = dialog.locator('[aria-label="League settings sections"]')
    await expect(sections.getByRole('button').first()).toHaveText(/Zombie Setup/)
    await expect(dialog.getByRole('heading', { name: 'League structure' })).toBeVisible()
    for (const [section, content] of [
      ['Automation', 'Weekly Automation Pipeline'],
      ['Overrides', 'Override Player Status'],
      ['Audit Log', 'No audit entries match your filters.'],
    ]) {
      await sections.getByRole('button', { name: new RegExp(section) }).click()
      await expect(dialog.getByText(content, { exact: true })).toBeVisible()
    }
    expect(overrideWrites).toEqual([])
    const setup = sections.getByRole('button', { name: /General/ })
    const paid = sections.getByRole('button', { name: /Paid \/ Free/ })
    await expect(setup).toBeVisible()
    await expect(paid).toBeVisible()
    const targets = await sections.getByRole('button').evaluateAll(buttons =>
      buttons.map(button => button.getBoundingClientRect().height),
    )
    expect(Math.min(...targets)).toBeGreaterThanOrEqual(44)

    await paid.click()
    await expect(dialog.getByText(/Paid \/ Free/).first()).toBeVisible()
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    expect(overflow).toBeLessThanOrEqual(1)

    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
    await expect(opener).toBeFocused()
  })
  test('opens Enhanced Armory from the phone drawer and sends a serum command', async ({ page }) => {
    test.setTimeout(120_000)
    const chimmyDm = { bodies: [] as Array<Record<string, unknown>> }
    await installZombieLeagueE2EMocks(page, leagueId, { chimmyDm })
    await page.goto(`/zombie/${leagueId}`)
    await expect(page.getByTestId('zombie-nav-more')).toBeVisible({ timeout: 30_000 })
    await page.getByTestId('zombie-nav-more').click()
    const drawer = page.getByRole('dialog')
    const armoryLink = drawer.locator(`a[href="/zombie/${leagueId}/items"]`)
    await expect(armoryLink).toBeVisible()
    expect(await armoryLink.evaluate(link => link.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44)
    await armoryLink.click()

    await expect(page.getByRole('heading', { name: 'The Armory' })).toBeVisible({ timeout: 30_000 })
    await expect(page.getByTestId('armory-weapons')).toBeVisible()
    const shield = page.getByRole('button', { name: 'Shield me this week' })
    await expect(shield).toBeVisible()
    expect(await shield.evaluate(button => button.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44)
    await shield.click()
    await expect.poll(() => chimmyDm.bodies).toContainEqual({
      leagueId, message: '@Chimmy use serum protect myself',
    })
    await expect(page.getByRole('status').filter({ hasText: /Chimmy received/ })).toBeVisible()
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    expect(overflow).toBeLessThanOrEqual(1)
  })

  test('keeps Simple Zombie focused on serums on a phone', async ({ page }) => {
    test.setTimeout(120_000)
    await installZombieLeagueE2EMocks(page, leagueId)
    await page.route('**/api/zombie/inventory**', async route => {
      await route.fulfill({ status: 200, json: {
        ...buildZombieInventoryPayload(), experienceMode: 'simple',
      } })
    })
    await page.goto(`/zombie/${leagueId}/items`)
    await expect(page.getByRole('heading', { name: 'The Armory' })).toBeVisible({ timeout: 30_000 })
    await expect(page.getByTestId('armory-serums')).toBeVisible()
    await expect(page.getByTestId('armory-simple-note')).toBeVisible()
    await expect(page.getByTestId('armory-weapons')).toHaveCount(0)
    await expect(page.getByRole('button', { name: /Arm Knife/ })).toHaveCount(0)
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    expect(overflow).toBeLessThanOrEqual(1)
  })

  test('keeps horde alerts touchable and victory cards readable with reduced motion', async ({ page }) => {
    test.setTimeout(120_000)
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await installZombieLeagueE2EMocks(page, leagueId)
    await page.route('**/api/zombie/league**', async route => {
      const url = new URL(route.request().url())
      if (route.request().method() !== 'GET' || url.pathname !== '/api/zombie/league') {
        await route.fallback()
        return
      }
      await route.fulfill({ status: 200, json: {
        ...buildZombieLeagueGetPayload(leagueId),
        hordeSitOuts: { myPendingResponse: { sitOutId: 'sit-out-1', week: 3 } },
        winCards: [{
          role: 'Whisperer', winnerName: 'Whisperer E2E', opponentName: 'E2E Survivors',
          winnerScore: 105, opponentScore: 97, week: 3,
        }],
      } })
    })
    await page.goto(`/zombie/${leagueId}`)
    const bell = page.getByRole('button', { name: /Zombie notifications/ })
    await expect(bell).toBeVisible({ timeout: 30_000 })
    expect(await bell.evaluate(button => button.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44)
    expect(await bell.evaluate(button => button.getBoundingClientRect().width)).toBeGreaterThanOrEqual(44)
    await bell.click()
    await expect(bell).toHaveAttribute('aria-expanded', 'true')
    const accept = page.getByRole('button', { name: 'Accept horde sit-out nomination' })
    const decline = page.getByRole('button', { name: 'Decline horde sit-out nomination' })
    await expect(accept).toBeVisible()
    await expect(decline).toBeVisible()
    for (const button of [accept, decline]) {
      const size = await button.evaluate(element => {
        const rect = element.getBoundingClientRect()
        return { width: rect.width, height: rect.height }
      })
      expect(size.width).toBeGreaterThanOrEqual(44)
      expect(size.height).toBeGreaterThanOrEqual(44)
    }
    const cards = page.getByRole('region', { name: 'Horde wins' })
    await expect(cards.getByText('Whisperer E2E wins')).toBeVisible()
    await expect(cards.getByText(/105\.0–97\.0/)).toBeVisible()
    const decoration = cards.locator('article [aria-hidden="true"]')
    expect(await decoration.evaluate(element => getComputedStyle(element).animationName)).toBe('none')
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    expect(overflow).toBeLessThanOrEqual(1)
  })
})

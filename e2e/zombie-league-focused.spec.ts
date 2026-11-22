import { expect, test } from '@playwright/test'
import { installZombieLeagueE2EMocks } from './helpers/mockZombieLeagueE2E'

test.describe.configure({ mode: 'serial', timeout: 120_000 })

test.describe('@zombie focused league shell + Chimmy DM + commissioner', () => {
  const leagueId = 'e2e-zombie-focused-league'

  test('zombie home loads with quick actions and universe tracker link', async ({ page }) => {
    await installZombieLeagueE2EMocks(page, leagueId)
    await page.goto(`/zombie/${leagueId}`)

    await expect(page.getByRole('main').getByRole('heading', { name: 'E2E Zombie League' })).toBeVisible({
      timeout: 30_000,
    })
    await expect(page.getByTestId('zombie-quick-chimmy')).toBeVisible()
    await expect(page.getByTestId('zombie-quick-serum')).toBeVisible()
    await expect(page.getByTestId('zombie-quick-weapon')).toBeVisible()
    await expect(page.getByTestId('zombie-quick-ambush')).toBeVisible()
    await expect(page.getByTestId('zombie-quick-universe')).toBeVisible()
  })

  test('chat hub sends a serum DM via POST /api/zombie/chimmy/dm', async ({ page }) => {
    const chimmyDm = { bodies: [] as Array<Record<string, unknown>> }
    await installZombieLeagueE2EMocks(page, leagueId, { chimmyDm })
    await page.goto(`/zombie/${leagueId}/chat`)

    await expect(page.getByRole('heading', { name: 'Chat & @Chimmy' })).toBeVisible({ timeout: 30_000 })
    await page.getByRole('button', { name: 'Protect Myself This Week' }).click()
    await expect(page.getByText('Send this as a DM command')).toBeVisible({ timeout: 10_000 })

    // Do not call `response.json()` here — it consumes the body before the page's fetch reads it.
    const dmDone = page.waitForResponse(
      (r) => r.url().includes('/api/zombie/chimmy/dm') && r.request().method() === 'POST',
    )
    await page.getByRole('button', { name: 'Send DM to @Chimmy' }).click()
    await dmDone

    // SerumUseCard resets to the pick step on success, which unmounts the confirm UI (and feedback) in the same tick.
    expect(chimmyDm.bodies.length).toBeGreaterThanOrEqual(1)
    expect(chimmyDm.bodies[0]?.leagueId).toBe(leagueId)
    expect(String(chimmyDm.bodies[0]?.message ?? '')).toMatch(/serum/i)
  })

  test('items page lists inventory and commissioner ops opens zombie settings tabs', async ({ page }) => {
    await installZombieLeagueE2EMocks(page, leagueId)
    await page.goto(`/zombie/${leagueId}/items`)

    await expect(page.getByText(/Serum/i).first()).toBeVisible({ timeout: 30_000 })
    await expect(page.getByText(/Knife/i).first()).toBeVisible()

    await page.goto(`/zombie/${leagueId}`)
    await expect(page.getByRole('main').getByRole('heading', { name: 'E2E Zombie League' })).toBeVisible({
      timeout: 30_000,
    })

    await page.getByTestId('zombie-nav-commissioner').click()
    await expect(page.getByRole('dialog', { name: /Commissioner settings/i })).toBeVisible({ timeout: 15_000 })
    await expect(page.getByRole('button', { name: 'Zombie Setup' })).toBeVisible()
    await page.getByRole('button', { name: 'Zombie Setup' }).click()
    await expect(page.getByRole('heading', { name: 'League structure' })).toBeVisible({ timeout: 15_000 })
  })
})

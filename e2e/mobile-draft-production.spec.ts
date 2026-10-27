import { expect, test, type Page } from '@playwright/test'

test.describe('@mock-draft-room mobile production mock room', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true })
  test.beforeEach(async ({ page }) => {
    await page.route('**/api/league/list', route => route.fulfill({ json: { leagues: [] } }))
    await page.route('**/api/mock-draft/adp?**', route => route.fulfill({ json: {
      entries: ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Foxtrot', 'Golf', 'Hotel', 'India'].map((name, index) => ({ playerId: name, name, position: 'PG', team: 'LAL', adp: index + 1, value: 100 })),
    } }))
    await page.route('**/api/chat/chimmy', route => route.fulfill({ json: { response: 'Mobile chat reply' } }))
    await page.goto('/e2e/mock-draft-production')
    await page.getByTestId('mock-draft-entry-open').tap()
    await page.getByTestId('mock-draft-open-sport-NBA').tap()
    await page.getByTestId('mock-draft-open-teams-8').tap()
    await page.getByTestId('mock-draft-open-speed-30').tap()
    await page.getByTestId('mock-draft-open-start').tap()
    await expect(page.getByTestId('mock-draft-current-pick')).toContainText('Pick #1')
  })

  async function players(page: Page) {
    await page.getByRole('button', { name: 'Players', exact: true }).tap()
    // The tray is a non-modal region over the board (DraftMobileTray), not a dialog.
    return page.getByRole('region', { name: 'Players', exact: true })
  }

  test('manual picks and off-turn touch queue survive reload; drawers remain reachable', async ({ page }, testInfo) => {
    const drawer = await players(page)
    await drawer.getByTestId('mock-draft-player-search').fill('Alpha')
    await drawer.getByTestId('mock-draft-player-row-Alpha').tap()
    await drawer.getByRole('button', { name: 'Close', exact: true }).tap()
    await page.getByTestId('mock-draft-pause').tap()
    await expect(page.getByTestId('mock-draft-current-pick')).toContainText('Pick #2')
    const queueDrawer = await players(page)
    await queueDrawer.getByTestId('mock-draft-player-search').fill('Bravo')
    await queueDrawer.getByRole('button', { name: 'Queue Bravo', exact: true }).tap()
    await expect(queueDrawer.getByRole('button', { name: 'Queue Bravo', exact: true })).toBeDisabled()
    await queueDrawer.getByRole('button', { name: 'Close', exact: true }).tap()
    await page.reload()
    await expect(page.getByText(/Recovered your mock draft/)).toBeVisible()
    await expect(page.getByTestId('mock-draft-resume')).toBeVisible()
    await expect(page.getByTestId('mock-draft-current-pick')).toContainText('Pick #2')
    const restored = await players(page)
    await expect(restored.getByText('Bravo', { exact: true }).first()).toBeVisible()
    await expect(restored.getByRole('button', { name: 'Queue Bravo', exact: true })).toBeDisabled()
    await page.screenshot({ path: testInfo.outputPath('mobile-mock-recovered.png') })
    await restored.getByRole('button', { name: 'Close', exact: true }).tap()
    for (const name of ['Roster', 'Chat']) {
      await page.getByRole('button', { name, exact: true }).tap()
      const panel = page.getByRole('region', { name: name === 'Roster' ? 'Current Roster' : 'Draft Chat', exact: true })
      await expect(panel).toBeVisible()
      if (name === 'Chat') {
        await panel.getByTestId('mock-draft-chat-input').fill('How is my NBA roster?')
        const reply = page.waitForResponse(response => response.url().endsWith('/api/chat/chimmy') && response.request().method() === 'POST')
        await panel.getByTestId('mock-draft-chat-send').tap()
        expect((await reply).ok()).toBe(true)
        await expect(panel.getByText('Mobile chat reply', { exact: true })).toBeVisible()
      }
      await panel.getByRole('button', { name: 'Close', exact: true }).tap()
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  })

  test('elapsed time expires the user clock and drafts the queued player once', async ({ page }) => {
    const drawer = await players(page)
    await drawer.getByRole('button', { name: 'Queue Bravo', exact: true }).tap()
    await drawer.getByRole('button', { name: 'Close', exact: true }).tap()
    await page.clock.setSystemTime(new Date(Date.now() + 31_000))
    await expect(page.getByTestId('mock-draft-current-pick')).toContainText('Pick #2')
    await page.getByTestId('mock-draft-pause').tap()
    const state = await page.evaluate(() => JSON.parse(localStorage.getItem('af:mock-draft:v1:e2e-mobile-viewer:open')!).state)
    expect(state.picks).toHaveLength(1)
    expect(state.picks[0].playerId).toBe('Bravo')
  })
})

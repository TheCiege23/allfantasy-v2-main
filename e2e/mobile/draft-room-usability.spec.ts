import { expect, test } from '@playwright/test'
import { createLeagueId, gotoDraftRoomHarness, openDraftRoomHarness, mockDraftRoomApis, prepareDraftRoomUsability } from '../helpers/draftRoomUsability'

test.describe.configure({ mode: 'serial', timeout: 180_000 })
test.beforeEach(async ({ page }) => {
  const size = page.viewportSize()
  await prepareDraftRoomUsability(page)
  if (size) await page.setViewportSize(size)
})

for (const sport of ['NFL', 'NBA', 'NHL', 'MLB'] as const) {
  test(sport + ' usability: phone players, filters and navigation remain reachable', async ({ page }) => {
    const leagueId = createLeagueId('e2e-phone-workspace')
    await mockDraftRoomApis(page, leagueId, sport)
    await gotoDraftRoomHarness(page, '/e2e/draft-room?leagueId=' + leagueId + '&sport=' + sport + '&e2eRoom=1')
    await openDraftRoomHarness(page)
    await page.getByTestId('draft-mobile-tab-players').click()
    const mobile = page.getByTestId('draft-mobile-layout')
    await expect(mobile.getByTestId('draft-mobile-tray')).toHaveAttribute('data-snap', 'full')
    const panel = mobile.getByTestId('draft-player-panel')
    await expect(panel.getByTestId('draft-player-card-0')).toBeVisible()
    const name = panel.getByTestId('draft-player-card-0-name')
    expect(await name.evaluate(node => parseFloat(getComputedStyle(node).fontSize))).toBeGreaterThanOrEqual(14)
    const list = panel.getByTestId('draft-player-list-scroll')
    expect((await list.boundingBox())!.height).toBeGreaterThan(180)
    const first = panel.getByTestId('draft-player-card-0')
    const bounds = await first.boundingBox()
    const listBounds = await list.boundingBox()
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(listBounds!.y + listBounds!.height)
    for (const id of ['draft-queue-add-0', 'draft-player-button-0']) {
      const button = panel.getByTestId(id)
      const box = await button.boundingBox()
      expect(box!.width).toBeGreaterThanOrEqual(44)
      expect(box!.height).toBeGreaterThanOrEqual(44)
    }
    await expect(panel.getByText('UNKNOWN', { exact: true })).toHaveCount(0)
    await expect(panel.getByText('No stats available', { exact: true })).toHaveCount(0)
    if (sport !== 'NFL') await expect(first.getByText(/Bye/)).toHaveCount(0)
    await panel.getByTestId('draft-player-filter-toggle').click()
    await expect(panel.getByTestId('draft-filter-rookies-only')).toBeVisible()
    await panel.getByTestId('draft-player-filter-toggle').click()
    const search = panel.getByTestId('draft-player-search-input')
    await search.fill(sport === 'NFL' ? 'Atlas' : sport === 'NBA' ? 'Hoops' : 'Test Player 1')
    expect(await search.evaluate(node => parseFloat(getComputedStyle(node).fontSize))).toBeGreaterThanOrEqual(16)
    await expect(panel.getByTestId('draft-player-card-0')).toBeVisible()
    await search.blur()
    await page.screenshot({ path: test.info().outputPath(sport + '-phone-players.png') })
    for (const tab of ['queue', 'roster', 'chat', 'board']) {
      await page.getByTestId('draft-mobile-tab-' + tab).click()
      await expect(page.getByTestId('draft-mobile-tab-' + tab)).toHaveAttribute('aria-pressed', 'true')
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    const nav = await page.getByTestId('draft-mobile-primary-nav').boundingBox()
    expect(nav!.y + nav!.height).toBeLessThanOrEqual(page.viewportSize()!.height + 1)
    // Rotation must preserve access to the active workspace, then recover phone navigation.
    const original = page.viewportSize()!
    await page.setViewportSize({ width: original.height, height: original.width })
    await expect(page.getByTestId('draft-desktop-layout').getByTestId('draft-player-panel')).toBeVisible()
    await page.setViewportSize(original)
    await expect(page.getByTestId('draft-mobile-primary-nav')).toBeVisible()
  })
}

import { expect, test } from '@playwright/test'
import { createLeagueId, gotoDraftRoomHarness, openDraftRoomHarness, mockDraftRoomApis, prepareDraftRoomUsability } from '../helpers/draftRoomUsability'

test.describe.configure({ timeout: 180_000 })
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
    // data-snap updates before the sheet's 200ms height transition finishes.
    // Wait for the actual browsing area, then retain geometry if a browser cannot reach it.
    try {
      await expect.poll(async () => (await list.boundingBox())?.height ?? 0, { timeout: 5_000 }).toBeGreaterThan(180)
    } finally {
      console.info('PHONE_DRAFT_GEOMETRY', JSON.stringify(await page.evaluate(() => {
        const bounds = (selector: string) => {
          const node = document.querySelector<HTMLElement>(selector)
          if (!node) return null
          const rect = node.getBoundingClientRect()
          const css = getComputedStyle(node)
          return { y: rect.y, height: rect.height, width: rect.width, display: css.display, overflow: css.overflow, flex: css.flex }
        }
        return {
          viewport: { width: innerWidth, height: innerHeight, visualHeight: visualViewport?.height, scale: visualViewport?.scale },
          shell: bounds('[data-testid="draft-room-shell"]'),
          header: bounds('[data-testid="draft-room-shell"] header'),
          layout: bounds('[data-testid="draft-mobile-layout"]'),
          tray: bounds('[data-testid="draft-mobile-tray"]'),
          trayContent: bounds('#draft-mobile-tray-content'),
          nav: bounds('[data-testid="draft-mobile-primary-nav"]'),
          panel: bounds('[data-testid="draft-mobile-layout"] [data-testid="draft-player-panel"]'),
          toolbar: bounds('[data-testid="draft-mobile-layout"] [data-testid="draft-player-toolbar"]'),
          filters: bounds('[data-testid="draft-mobile-layout"] [data-testid="draft-extra-player-filters"]'),
          list: bounds('[data-testid="draft-mobile-layout"] [data-testid="draft-player-list-scroll"]'),
        }
      })))
    }
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
    await expect(page.getByTestId('draft-mobile-layout')).toBeVisible()
    await expect(page.getByTestId('draft-desktop-layout')).toBeHidden()
    const rotatedNav = await page.getByTestId('draft-mobile-primary-nav').boundingBox()
    expect(rotatedNav!.y + rotatedNav!.height).toBeLessThanOrEqual(original.width + 1)
    await page.setViewportSize(original)
    await expect(page.getByTestId('draft-mobile-primary-nav')).toBeVisible()
  })
}

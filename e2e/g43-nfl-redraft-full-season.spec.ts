import { expect, test, type Page } from '@playwright/test'

const HARNESS_PATH = '/e2e/g43-nfl-redraft-full-season'

test.describe.configure({ timeout: 180_000 })

async function gotoHarness(page: Page) {
  await page.goto(HARNESS_PATH, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  await page.getByTestId('g43-full-season-harness').waitFor({ state: 'visible', timeout: 120_000 })
}

test.describe('@g43 @nfl-redraft full season browser proof', () => {
  test('renders the complete draft to champion runtime journey', async ({ page }) => {
    await gotoHarness(page)

    await expect(page.getByTestId('g43-league-home')).toContainText('G43 Full Season Runtime Proof')
    await expect(page.getByTestId('g43-draft-complete')).toContainText('Complete')
    await expect(page.getByTestId('g43-roster-visible')).toContainText('Alpha Storm')
    await expect(page.getByTestId('g43-roster-visible')).toContainText('Valid')
    await expect(page.getByTestId('g43-schedule-visible')).toContainText('W1')
    await expect(page.getByTestId('g43-matchup-visible')).toContainText('Final Standings')
    await expect(page.getByTestId('g43-waiver-flow')).toContainText('waiver-rb')
    await expect(page.getByTestId('g43-trade-flow')).toContainText('g43-trade-alpha-bravo')
    await expect(page.getByTestId('g43-playoff-champion')).toContainText('Champion Crowned')
    await expect(page.getByTestId('g43-playoff-visible')).toContainText('Final History')
    await expect(page.getByTestId('g43-notification-feed')).toContainText('Notifications')
    await expect(page.getByTestId('g43-canonical-events')).toContainText('draft.completed')
    await expect(page.getByTestId('g43-canonical-events')).toContainText('playoffs.champion.crowned')

    const invariantRows = page.getByTestId('g43-invariant-row')
    await expect(invariantRows).toHaveCount(13)
    await expect(invariantRows.filter({ hasText: 'Failed' })).toHaveCount(0)
  })

  test('keeps the full-season proof usable on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await gotoHarness(page)

    await expect(page.getByTestId('g43-mobile-layout')).toBeVisible()
    await expect(page.getByTestId('g43-draft-complete')).toContainText('Complete')
    await expect(page.getByTestId('g43-playoff-champion')).toContainText('Champion Crowned')
    await expect(page.getByTestId('g43-notification-feed')).toBeVisible()

    const noHorizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 2)
    expect(noHorizontalOverflow).toBeTruthy()
  })
})

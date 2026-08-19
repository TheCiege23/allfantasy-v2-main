import { expect, test, type Page } from '@playwright/test'

test.describe('G39 NFL redraft trade runtime harness', () => {
  test.describe.configure({ mode: 'serial', timeout: 180_000 })

  async function gotoHarness(page: Page) {
    await page.goto('/e2e-g39-nfl-redraft-trade-runtime', { waitUntil: 'domcontentloaded', timeout: 120_000 })
    const harness = page.getByTestId('g39-trade-harness')
    await harness.waitFor({ state: 'visible', timeout: 120_000 })
    await expect(harness).toHaveAttribute('data-hydrated', 'true')
  }

  test('manager proposal, accept, veto, invalid block, and history render', async ({ page }) => {
    await gotoHarness(page)
    await expect(page.getByTestId('trade-runtime-summary')).toContainText('Pending')

    await page.getByTestId('submit-trade-proposal').click()
    await expect(page.getByTestId('trade-message')).toContainText('Proposal created')
    await expect(page.getByTestId('trade-history')).toContainText('trade.proposed')

    await page.getByTestId('accept-trade').click()
    await expect(page.getByTestId('trade-message')).toContainText('rosters updated')
    await expect(page.getByTestId('roster-alpha')).toContainText('Beta WR')
    await expect(page.getByTestId('roster-alpha')).not.toContainText('Alpha RB')
    await expect(page.getByTestId('trade-history')).toContainText('trade.executed')
    await expect(page.getByTestId('trade-history')).toContainText('trade.transaction.recorded')

    await page.getByTestId('commissioner-veto-trade').click()
    await expect(page.getByTestId('trade-message')).toContainText('Commissioner veto recorded')
    await expect(page.getByTestId('trade-history')).toContainText('trade.vetoed')

    await page.getByTestId('invalid-trade').click()
    await expect(page.getByTestId('trade-message')).toContainText('is not active on the sending roster')
  })

  test('mobile layout remains usable', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await gotoHarness(page)
    await expect(page.getByTestId('trade-runtime-summary')).toBeVisible()
    await page.getByTestId('accept-trade').click()
    await expect(page.getByTestId('roster-alpha')).toContainText('Beta WR')
    await expect(page.getByTestId('roster-beta')).toBeVisible()
  })
})

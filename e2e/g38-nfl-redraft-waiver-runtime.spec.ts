import { expect, test, type Page } from '@playwright/test'

test.describe.configure({ timeout: 180_000 })

const HARNESS_PATH = '/e2e/g38-nfl-redraft-waiver-runtime'

async function gotoHarness(page: Page) {
  await page.goto(HARNESS_PATH, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  await page.getByTestId('g38-waiver-harness').waitFor({ state: 'visible', timeout: 120_000 })
  await expect(page.getByTestId('g38-waiver-harness')).toHaveAttribute('data-hydrated', 'true', { timeout: 120_000 })
}

test.describe('@g38 @nfl-redraft waiver runtime browser proof', () => {
  test.describe.configure({ mode: 'serial' })

  test('desktop flow submits claim, processes waivers, updates roster, and records transactions', async ({ page }) => {
    await gotoHarness(page)

    await expect(page.getByTestId('g38-waiver-harness')).toBeVisible()
    await expect(page.getByTestId('waiver-runtime-summary')).toContainText('FAAB')
    await expect(page.getByTestId('pending-claims')).toContainText('beta-high')

    await page.getByTestId('submit-waiver-claim').click()
    await expect(page.getByTestId('g38-waiver-harness')).toHaveAttribute('data-hydrated', 'true')
    await expect(page.getByTestId('pending-claims')).toContainText('alpha-low')

    await page.getByTestId('process-waivers').click()
    await expect(page.getByTestId('waiver-results')).toContainText('beta-high')
    await expect(page.getByTestId('waiver-results')).toContainText('won')
    await expect(page.getByTestId('waiver-results')).toContainText('alpha-low')
    await expect(page.getByTestId('waiver-results')).toContainText('Player is already rostered in this season')
    await expect(page.getByTestId('roster-beta')).toContainText('Target A')
    await expect(page.getByTestId('transaction-history')).toContainText('waiver_claim_approved')

    await page.getByTestId('add-free-agent').click()
    await expect(page.getByTestId('roster-alpha')).toContainText('Target B')
    await expect(page.getByTestId('transaction-history')).toContainText('free_agent_added')
  })

  test('mobile waiver runtime layout remains usable', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 900 })
    await gotoHarness(page)

    await expect(page.getByTestId('g38-waiver-harness')).toBeVisible()
    await page.getByTestId('submit-waiver-claim').click()
    await expect(page.getByTestId('pending-claims')).toContainText('alpha-low')
    await page.getByTestId('process-waivers').click()
    await expect(page.getByTestId('waiver-results')).toContainText('alpha-low')
    await expect(page.getByTestId('transaction-history')).toBeVisible()
  })
})

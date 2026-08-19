import { expect, test, type Page } from '@playwright/test'

test.describe.configure({ timeout: 180_000 })

const HARNESS_PATH = '/e2e/g37-nfl-redraft-live-scoring'

async function gotoHarness(page: Page, query = '') {
  await page.goto(`${HARNESS_PATH}${query}`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  await page.getByTestId('g37-live-scoring-harness').waitFor({ state: 'visible', timeout: 120_000 })
  await page.getByTestId('redraft-live-scoring-view').waitFor({ state: 'visible', timeout: 120_000 })
  await expect(page.getByTestId('g37-live-scoring-harness')).toHaveAttribute('data-hydrated', 'true')
}

test.describe('@g37 @nfl-redraft live scoring browser proof', () => {
  test.describe.configure({ mode: 'serial' })

  test('desktop dark mode renders final live matchup totals, starters, bench, and winner', async ({ page }) => {
    await gotoHarness(page)

    await expect(page.locator('main[data-mode="dark"]')).toBeVisible()
    await expect(page.getByTestId('redraft-live-scoring-view')).toContainText('Week 1 - final')
    await expect(page.getByTestId('redraft-live-scoring-view')).toContainText('Alpha Redraft')
    await expect(page.getByTestId('redraft-live-scoring-view')).toContainText('Bravo Redraft')
    await expect(page.getByTestId('redraft-live-scoring-view')).toContainText('Winner: Bravo Redraft')
    await expect(page.getByTestId('redraft-live-scoring-view')).toContainText('Quarterback One')
    await expect(page.getByTestId('redraft-live-scoring-view')).toContainText('22.40')
    await expect(page.getByTestId('redraft-live-scoring-view')).toContainText('Premium Tight End')
    await expect(page.getByTestId('redraft-live-scoring-view')).toContainText('12.00')
    await expect(page.getByTestId('redraft-live-scoring-view')).toContainText('Bench Runner')
    await expect(page.getByTestId('redraft-live-scoring-view')).toContainText('21.00')
  })

  test('standings and commissioner audit reflect resolved scoring and corrections', async ({ page }) => {
    await gotoHarness(page)

    await expect(page.getByTestId('redraft-live-standings')).toContainText('1. Bravo Redraft')
    await expect(page.getByTestId('redraft-live-standings')).toContainText('1-0-0')
    await expect(page.getByTestId('redraft-live-standings')).toContainText('PF 52.00')
    await expect(page.getByTestId('redraft-live-standings')).toContainText('2. Alpha Redraft')
    await expect(page.getByTestId('redraft-scoring-audit')).toContainText('Correction version 1')
    await expect(page.getByTestId('redraft-scoring-audit')).toContainText('bench points remain separated')
  })

  test('mobile live scoring layout remains usable', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await gotoHarness(page)

    await expect(page.getByTestId('redraft-live-scoring-view')).toBeVisible()
    await expect(page.getByTestId('redraft-live-scoring-view')).toContainText('Starter total')
    await expect(page.getByTestId('redraft-live-scoring-view')).toContainText('Bench points')
    const box = await page.getByTestId('redraft-live-scoring-view').boundingBox()
    expect(box?.width ?? 0).toBeLessThanOrEqual(390)
  })

  test('light mode smoke renders the same live scoring surface', async ({ page }) => {
    await gotoHarness(page, '?mode=light')

    await expect(page.locator('main[data-mode="light"]')).toBeVisible()
    await expect(page.getByTestId('redraft-live-scoring-view')).toContainText('live scoring')
    await expect(page.getByTestId('redraft-live-standings')).toContainText('Standings after scoring')
  })
})

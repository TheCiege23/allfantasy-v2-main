import { expect, test, type Page } from '@playwright/test'

test.describe.configure({ timeout: 180_000 })

const HARNESS_PATH = '/e2e/g36-nfl-redraft-schedule'

async function gotoHarness(page: Page, query = '') {
  await page.goto(`${HARNESS_PATH}${query}`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  await page.getByTestId('g36-schedule-harness').waitFor({ state: 'visible', timeout: 120_000 })
  await page.getByTestId('redraft-schedule-view').waitFor({ state: 'visible', timeout: 120_000 })
  await expect(page.getByTestId('g36-schedule-harness')).toHaveAttribute('data-hydrated', 'true')
  await expect(page.getByRole('button', { name: 'W2' })).toHaveAttribute('aria-pressed', 'true')
}

test.describe('@g36 @nfl-redraft schedule runtime browser proof', () => {
  test.describe.configure({ mode: 'serial' })

  test('desktop dark mode renders current week matchups, playoff prep, and bye indicators', async ({ page }) => {
    await gotoHarness(page)

    await expect(page.locator('main[data-mode="dark"]')).toBeVisible()
    await expect(page.getByTestId('redraft-schedule-view')).toContainText('Week 2 matchups')
    await expect(page.getByTestId('redraft-schedule-view')).toContainText('3 regular season weeks')
    await expect(page.getByTestId('redraft-schedule-view')).toContainText('Playoffs prep starts week 4')
    await expect(page.getByTestId('redraft-schedule-matchup')).toHaveCount(2)
    await expect(page.getByTestId('redraft-schedule-bye')).toContainText('Delta')
    await expect(page.getByText('#1 Alpha')).toBeVisible()
    await expect(page.getByText('All teams are covered once per scheduled week')).toBeVisible()
  })

  test('week picker changes the visible schedule without losing selected-state clarity', async ({ page }) => {
    await gotoHarness(page)

    await page.getByRole('button', { name: 'W1' }).click()
    await expect(page.getByTestId('redraft-schedule-view')).toContainText('Week 1 matchups')
    await expect(page.getByTestId('redraft-schedule-view')).toContainText('Division matchup')
    await expect(page.getByTestId('redraft-schedule-bye')).toContainText('Echo')
    await expect(page.getByRole('button', { name: 'W1' })).toHaveAttribute('aria-pressed', 'true')
  })

  test('mobile layout remains usable', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await gotoHarness(page)

    await expect(page.getByTestId('redraft-schedule-view')).toBeVisible()
    await expect(page.getByTestId('redraft-schedule-week-picker')).toBeVisible()
    await page.getByRole('button', { name: 'W3' }).click()
    await expect(page.getByTestId('redraft-schedule-view')).toContainText('Week 3 matchups')
    await expect(page.getByTestId('redraft-schedule-bye')).toContainText('Charlie')
  })

  test('light mode smoke renders the same deterministic schedule surface', async ({ page }) => {
    await gotoHarness(page, '?mode=light')

    await expect(page.locator('main[data-mode="light"]')).toBeVisible()
    await expect(page.getByTestId('redraft-schedule-view')).toContainText('Week 2 matchups')
    await expect(page.getByTestId('redraft-schedule-view')).toContainText('Schedule health')
  })
})

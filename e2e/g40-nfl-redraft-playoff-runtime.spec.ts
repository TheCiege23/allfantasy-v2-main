import { expect, test, type Page } from '@playwright/test'

test.describe('G40 NFL redraft playoff runtime harness', () => {
  test.describe.configure({ mode: 'serial', timeout: 180_000 })

  async function gotoHarness(page: Page) {
    await page.goto('/e2e-g40-nfl-redraft-playoff-runtime', { waitUntil: 'domcontentloaded', timeout: 120_000 })
    const harness = page.getByTestId('g40-playoff-harness')
    await harness.waitFor({ state: 'visible', timeout: 120_000 })
    await expect(harness).toHaveAttribute('data-hydrated', 'true')
  }

  test('generates bracket, advances all rounds, crowns champion, and shows events', async ({ page }) => {
    await gotoHarness(page)
    await expect(page.getByTestId('playoff-runtime-summary')).toContainText('Teams')
    await expect(page.getByTestId('playoff-bracket')).toContainText('No bracket generated yet')

    await page.getByTestId('generate-playoff-bracket').click()
    await expect(page.getByTestId('playoff-message')).toContainText('Bracket generated')
    await expect(page.getByTestId('playoff-seeds')).toContainText('Alpha')
    await expect(page.getByTestId('playoff-bracket')).toContainText('Quarterfinal')
    await expect(page.getByTestId('playoff-events')).toContainText('playoffs.bracket.generated')

    await page.getByTestId('advance-playoff-round').click()
    await expect(page.getByTestId('playoff-message')).toContainText('Round advanced')
    await expect(page.getByTestId('playoff-events')).toContainText('playoffs.team.advanced')

    await page.getByTestId('advance-playoff-round').click()
    await expect(page.getByTestId('playoff-message')).toContainText('Round advanced')

    await page.getByTestId('advance-playoff-round').click()
    await expect(page.getByTestId('playoff-message')).toContainText('Championship ready')

    await page.getByTestId('finalize-playoff-season').click()
    await expect(page.getByTestId('playoff-message')).toContainText('Champion crowned')
    await expect(page.getByTestId('champion-banner')).toContainText('Champion crowned')
    await expect(page.getByTestId('final-standings')).toContainText('1.')
    await expect(page.getByTestId('playoff-events')).toContainText('playoffs.champion.crowned')
    await expect(page.getByTestId('playoff-events')).toContainText('season.completed')
  })

  test('mobile layout remains usable', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await gotoHarness(page)
    await expect(page.getByTestId('playoff-runtime-summary')).toBeVisible()
    await page.getByTestId('generate-playoff-bracket').click()
    await expect(page.getByTestId('playoff-bracket')).toContainText('Quarterfinal')
    await expect(page.getByTestId('advance-playoff-round')).toBeVisible()
  })
})

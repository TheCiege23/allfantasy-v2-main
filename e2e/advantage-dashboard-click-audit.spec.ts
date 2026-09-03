import { expect, test, type Page } from '@playwright/test'

test.describe.configure({ mode: 'serial', timeout: 120_000 })

async function openHarness(page: Page) {
  await page.goto('/e2e/advantage-dashboard', { waitUntil: 'domcontentloaded' })
  await expect(page.getByRole('heading', { name: 'Advantage Dashboard Harness' })).toBeVisible()
  await expect(page.getByTestId('advantage-hydrated-flag')).toContainText(/hydrat/i)
  await expect(page.getByTestId('advantage-card-trend-alerts')).toBeVisible()
}

test.describe('@advantage dashboard click audit', () => {
  test('dashboard renders live previews for each intelligence surface', async ({ page }) => {
    await openHarness(page)

    await expect(page.getByTestId('advantage-hero-summary')).toContainText(/advantage pulse/i)
    await expect(page.getByTestId('advantage-card-trend-alerts')).toContainText('Sky Moore')
    await expect(page.getByTestId('advantage-card-coach-advice')).toContainText('Open Waiver AI')
    await expect(page.getByTestId('advantage-card-power-rankings')).toContainText('Alpha Gridiron')
    await expect(page.getByTestId('advantage-card-simulation-insights')).toContainText(
      'NFL Alpha'
    )
  })

  test('every dashboard card opens its related tool', async ({ page }) => {
    await openHarness(page)

    const trendCard = page.getByTestId('advantage-card-trend-alerts')
    await expect(trendCard).toHaveAttribute('href', '/app/trend-feed')
    await Promise.all([
      page.waitForURL(/\/app\/trend-feed/, { timeout: 15_000 }),
      trendCard.click(),
    ])

    await openHarness(page)

    const coachCard = page.getByTestId('advantage-card-coach-advice')
    await expect(coachCard).toHaveAttribute('href', '/app/coach')
    await Promise.all([
      page.waitForURL(/\/app\/coach/, { timeout: 15_000 }),
      coachCard.click(),
    ])

    await openHarness(page)

    /*
     * ⚠ THIS CARD POINTED AT A DEPRECATED ALIAS, AND THE WAIT COULD NEVER MATCH.
     *
     * middleware.ts (redirectDeprecatedAppRoutes) 307s /app/power-rankings to
     * /power-rankings. So the href assertion passed, the click navigated fine, and
     * waitForURL(/\/app\/power-rankings/) then waited 15s for a URL the browser had
     * already been redirected away from — reported as a click that went nowhere.
     * The card now links to the canonical path, so there is no redirect to lose.
     */
    const powerCard = page.getByTestId('advantage-card-power-rankings')
    await expect(powerCard).toHaveAttribute('href', '/power-rankings')
    await Promise.all([
      page.waitForURL(/\/power-rankings/, { timeout: 15_000 }),
      powerCard.click(),
    ])

    await openHarness(page)

    const simulationCard = page.getByTestId('advantage-card-simulation-insights')
    await expect(simulationCard).toHaveAttribute('href', '/app/matchup-simulation')
    await Promise.all([
      page.waitForURL(/\/app\/matchup-simulation/, { timeout: 15_000 }),
      simulationCard.click(),
    ])
  })
})

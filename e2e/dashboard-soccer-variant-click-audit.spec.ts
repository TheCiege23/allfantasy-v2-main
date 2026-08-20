import { expect, test } from '@playwright/test'
import { clickHydrated } from './helpers/hydration'

test.describe.configure({ timeout: 150_000 })

test('shows Soccer grouped card with Standard variant and click-through to league shell', async ({
  page,
}) => {
  const soccerLeagueId = 'soccer-e2e-123'
  const soccerLeagueName = 'Soccer Dashboard Harness League'

  await page.route('**/api/league/list', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        leagues: [
          {
            id: soccerLeagueId,
            name: soccerLeagueName,
            sport: 'SOCCER',
            sport_type: 'SOCCER',
            leagueVariant: 'STANDARD',
            league_variant: 'STANDARD',
            platform: 'manual',
            leagueSize: 12,
            isDynasty: false,
            syncStatus: 'manual',
            rosters: [],
          },
        ],
      }),
    })
  })

  await page.route('**/api/league/roster**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ roster: [], faabRemaining: null, waiverPriority: null }),
    })
  })

  await page.route('**/api/bracket/leagues/**/standings', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ standings: [] }),
    })
  })

  await page.route('**/api/bracket/leagues/**/chat', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ messages: [] }),
    })
  })

  await page.route('**/api/content-feed**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ items: [] }),
    })
  })

  await page.route('**/api/sports/news**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ news: [] }),
    })
  })

  await page.route('**/api/sports/weather**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ weather: null }),
    })
  })

  await page.route(`**/api/leagues/${soccerLeagueId}`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: soccerLeagueId,
        name: soccerLeagueName,
        sport: 'SOCCER',
        leagueVariant: 'STANDARD',
        isDynasty: false,
      }),
    })
  })

  await page.route(`**/api/commissioner/leagues/${soccerLeagueId}/check**`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ isCommissioner: false }),
    })
  })

  await page.goto('/e2e/dashboard-soccer-grouping')

  await clickHydrated(page.getByRole('button', { name: 'My Leagues' }))
  await expect(page.locator('text=Loading your connected leagues...')).not.toBeVisible({ timeout: 20_000 })

  const soccerSection = page
    .locator('section')
    .filter({ has: page.getByRole('heading', { name: /^Soccer$/ }) })
    .first()

  await expect(soccerSection).toBeVisible({ timeout: 45_000 })
  const soccerCard = soccerSection.getByRole('link', { name: new RegExp(soccerLeagueName) }).first()
  await expect(soccerCard).toBeVisible({ timeout: 45_000 })
  await expect(soccerCard).toContainText('Standard')
  await expect(soccerCard).toHaveAttribute('href', new RegExp(`^/league/${soccerLeagueId}$`))

  await clickHydrated(soccerCard)
  await expect(page).toHaveURL(new RegExp(`/league/${soccerLeagueId}$`), { timeout: 45_000 })
  await expect(page.getByRole('button', { name: 'Overview', exact: true })).toBeVisible({ timeout: 30_000 })
})

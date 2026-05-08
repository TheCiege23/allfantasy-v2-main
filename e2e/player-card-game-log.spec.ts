import { expect, test } from '@playwright/test'

// First-compile of the harness route under `next dev` can exceed the 30s
// default on cold caches. Bump per-test timeout so the harness route compile
// does not flake the suite.
test.describe.configure({ timeout: 120_000 })

const HARNESS_URL = '/e2e/player-card-game-log'

const burrowSeasonHistory = [
  {
    season: '2025',
    gamesPlayed: 8,
    fantasyPoints: 145.46,
    fantasyPointsPerGame: 18.18,
    team: 'CIN',
    stats: {
      passing_yards: 1809,
      passing_touchdowns: 17,
      passing_interceptions: 5,
      rushing_yards: 41,
    },
  },
  {
    season: '2024',
    gamesPlayed: 17,
    fantasyPoints: 407.82,
    fantasyPointsPerGame: 23.99,
    team: 'CIN',
    stats: {
      passing_yards: 4918,
      passing_touchdowns: 43,
      passing_interceptions: 9,
      rushing_yards: 201,
    },
  },
  {
    season: '2023',
    gamesPlayed: 10,
    fantasyPoints: 163.16,
    fantasyPointsPerGame: 16.32,
    team: 'CIN',
    stats: {
      passing_yards: 2309,
      passing_touchdowns: 15,
      passing_interceptions: 6,
    },
  },
]

test.describe('@player-card game-log season selector', () => {
  test('renders all available NFL seasons and switches between them', async ({ page }) => {
    await page.route('**/api/player-card-analytics', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          playerId: 'e2e-harness-player',
          playerName: 'E2E Harness Player',
          position: 'QB',
          team: 'CIN',
          sport: 'NFL',
          aiInsights: null,
          metaTrends: null,
          matchupPrediction: null,
          careerProjection: null,
          seasonHistory: burrowSeasonHistory,
        }),
      })
    })

    await page.goto(HARNESS_URL)

    // The tab booted with data, not the empty state.
    await expect(page.getByTestId('game-log-tab')).toBeVisible()
    await expect(page.getByTestId('game-log-tab-empty')).toHaveCount(0)

    // One pill per season.
    await expect(page.getByTestId('season-tab-2025')).toBeVisible()
    await expect(page.getByTestId('season-tab-2024')).toBeVisible()
    await expect(page.getByTestId('season-tab-2023')).toBeVisible()

    // Default selection is the most recent season.
    await expect(page.getByTestId('season-tab-2025')).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByTestId('season-stats-2025')).toBeVisible()
    await expect(page.getByTestId('season-stats-2024')).toHaveCount(0)

    // Required QB fields render for the selected season.
    const card2025 = page.getByTestId('season-stats-2025')
    await expect(card2025).toContainText('8 GP')
    await expect(card2025).toContainText('Fantasy Pts')
    await expect(card2025).toContainText('145.5')
    await expect(card2025).toContainText('Pts/Game')
    await expect(card2025).toContainText('18.2')
    await expect(card2025).toContainText('Pass Yds')
    await expect(card2025).toContainText('1809')
    await expect(card2025).toContainText('Pass TD')
    await expect(card2025).toContainText('17')
    await expect(card2025).toContainText('INT')

    // Click the 2024 tab — stats panel should swap to 2024 numbers.
    await page.getByTestId('season-tab-2024').click()
    await expect(page.getByTestId('season-tab-2024')).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByTestId('season-tab-2025')).toHaveAttribute('aria-selected', 'false')
    await expect(page.getByTestId('season-stats-2025')).toHaveCount(0)

    const card2024 = page.getByTestId('season-stats-2024')
    await expect(card2024).toBeVisible()
    await expect(card2024).toContainText('17 GP')
    await expect(card2024).toContainText('407.8')
    await expect(card2024).toContainText('4918')
    await expect(card2024).toContainText('43')

    // 2023 has the injury-shortened line.
    await page.getByTestId('season-tab-2023').click()
    const card2023 = page.getByTestId('season-stats-2023')
    await expect(card2023).toBeVisible()
    await expect(card2023).toContainText('10 GP')
    await expect(card2023).toContainText('2309')
  })

  test('shows the empty state when the API returns no season history', async ({ page }) => {
    await page.route('**/api/player-card-analytics', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          playerId: 'e2e-harness-player',
          playerName: 'E2E Harness Player',
          position: 'QB',
          team: 'CIN',
          sport: 'NFL',
          aiInsights: null,
          metaTrends: null,
          matchupPrediction: null,
          careerProjection: null,
          seasonHistory: null,
        }),
      })
    })

    await page.goto(HARNESS_URL)
    await expect(page.getByTestId('game-log-tab-empty')).toBeVisible()
    await expect(page.getByTestId('season-selector')).toHaveCount(0)
  })

  test('still works when the server uses the legacy `seasonStats` key', async ({ page }) => {
    await page.route('**/api/player-card-analytics', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ seasonStats: burrowSeasonHistory }),
      })
    })

    await page.goto(HARNESS_URL)
    await expect(page.getByTestId('season-tab-2025')).toBeVisible()
    await expect(page.getByTestId('season-tab-2024')).toBeVisible()
    await expect(page.getByTestId('season-tab-2023')).toBeVisible()
  })
})

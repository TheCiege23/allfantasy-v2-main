import { expect, test } from '@playwright/test'
import { signInAs } from './helpers/session-cookie'

test.describe.configure({ timeout: 180_000 })

test.describe('@simulation full click audit', () => {
  test('audits matchup, season, playoff, dynasty and league simulation interactions', async ({ page }) => {
    const matchupRequests: Array<Record<string, unknown>> = []
    const seasonLabRequests: Array<Record<string, unknown>> = []
    const playoffLabRequests: Array<Record<string, unknown>> = []
    const dynastyLabRequests: Array<Record<string, unknown>> = []
    const seasonForecastGets: Array<{ season: string | null; week: string | null }> = []
    const seasonForecastPosts: Array<Record<string, unknown>> = []
    const forecastSummaryPosts: Array<Record<string, unknown>> = []
    const matchupsApiCalls: Array<{ week: string | null }> = []

    await page.route('**/api/simulation/matchup', async (route) => {
      const body = route.request().postDataJSON() as Record<string, unknown>
      matchupRequests.push(body)

      const teamA = (body.teamA ?? {}) as { mean?: number }
      const teamB = (body.teamB ?? {}) as { mean?: number }
      const meanA = Number(teamA.mean ?? 100)
      const meanB = Number(teamB.mean ?? 95)
      const winA = meanA / Math.max(1, meanA + meanB)

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          simulationId: 'sim_click_audit_1',
          winProbabilityA: Number(winA.toFixed(3)),
          winProbabilityB: Number((1 - winA).toFixed(3)),
          marginMean: Number((meanA - meanB).toFixed(1)),
          marginStdDev: 9.8,
          projectedScoreA: meanA,
          projectedScoreB: meanB,
          scoreRangeA: [Math.max(0, meanA - 12), meanA + 12],
          scoreRangeB: [Math.max(0, meanB - 12), meanB + 12],
          upsetChance: 21.3,
          volatilityTag: 'medium',
          iterations: 1500,
          upsideScenario: { teamA: meanA + 11, teamB: meanB + 10, percentile: 90 },
          downsideScenario: { teamA: Math.max(0, meanA - 13), teamB: Math.max(0, meanB - 13), percentile: 10 },
          scoreDistributionA: Array.from({ length: 50 }, (_, i) => meanA - 10 + i * 0.5),
          scoreDistributionB: Array.from({ length: 50 }, (_, i) => meanB - 10 + i * 0.5),
        }),
      })
    })

    await page.route('**/api/simulation-lab/season', async (route) => {
      const body = route.request().postDataJSON() as Record<string, unknown>
      seasonLabRequests.push(body)
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          sport: String(body.sport ?? 'NFL'),
          expectedWins: 8.4,
          playoffProbability: 0.63,
          byeWeekProbability: 0.22,
          iterations: Number(body.iterations ?? 2000),
        }),
      })
    })

    await page.route('**/api/simulation-lab/playoffs', async (route) => {
      const body = route.request().postDataJSON() as Record<string, unknown>
      playoffLabRequests.push(body)
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          sport: String(body.sport ?? 'NFL'),
          championshipProbability: 0.28,
          finalistProbability: 0.51,
          iterations: Number(body.iterations ?? 3000),
        }),
      })
    })

    await page.route('**/api/simulation-lab/dynasty', async (route) => {
      const body = route.request().postDataJSON() as Record<string, unknown>
      dynastyLabRequests.push(body)
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          sport: String(body.sport ?? 'NFL'),
          seasonsRun: Number(body.seasons ?? 50),
          iterationsPerSeason: 1,
          outcomes: [
            { teamIndex: 0, name: 'Team 1', championships: 11, totalWins: 9.2, avgFinish: 2.3, playoffAppearances: 40 },
            { teamIndex: 1, name: 'Team 2', championships: 8, totalWins: 8.7, avgFinish: 2.9, playoffAppearances: 36 },
          ],
        }),
      })
    })

    await page.route('**/api/legacy/identity', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ identity: { recommendedUserId: 'user-sim-1', source: 'e2e' } }),
      })
    })

    await page.route('**/api/bracket/my-leagues', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          leagues: [
            {
              id: 'league_sim_1',
              name: 'Simulation League',
              sport: 'NBA',
              _count: { members: 10, entries: 10 },
            },
          ],
        }),
      })
    })

    await page.route('**/api/bracket/leagues/league_sim_1/standings', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          standings: [
            { entryId: 'teamA', entryName: 'Alpha', ownerName: 'A', points: 901, picksCount: 100, rank: 1 },
            { entryId: 'teamB', entryName: 'Bravo', ownerName: 'B', points: 855, picksCount: 98, rank: 2 },
            { entryId: 'teamC', entryName: 'Charlie', ownerName: 'C', points: 821, picksCount: 95, rank: 3 },
          ],
        }),
      })
    })

    await page.route('**/api/bracket/entries?**', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ entries: [] }) })
    })

    await page.route('**/api/league/roster?**', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ roster: null }) })
    })

    await page.route('**/api/bracket/leagues/league_sim_1/chat', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ messages: [] }) })
    })

    await page.route('**/api/leagues/league_sim_1/season-forecast?**', async (route) => {
      const url = new URL(route.request().url())
      const season = url.searchParams.get('season')
      const week = url.searchParams.get('week')
      seasonForecastGets.push({ season, week })

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          generated: true,
          generatedAt: '2026-03-20T12:00:00.000Z',
          teamForecasts: [
            {
              teamId: 'teamA',
              teamName: 'Alpha',
              playoffProbability: 84.2,
              firstPlaceProbability: 47.5,
              championshipProbability: 28.1,
              expectedWins: 10.7,
              expectedFinalSeed: 1.6,
              finishRange: { min: 1, max: 4 },
              eliminationRisk: 15.8,
              byeProbability: 42.2,
              confidenceScore: 78,
            },
            {
              teamId: 'teamB',
              teamName: 'Bravo',
              playoffProbability: 61.4,
              firstPlaceProbability: 20.3,
              championshipProbability: 16.9,
              expectedWins: 9.1,
              expectedFinalSeed: 2.8,
              finishRange: { min: 1, max: 6 },
              eliminationRisk: 38.6,
              byeProbability: 21.6,
              confidenceScore: 74,
            },
          ],
        }),
      })
    })

    await page.route('**/api/leagues/league_sim_1/season-forecast', async (route) => {
      const body = route.request().postDataJSON() as Record<string, unknown>
      seasonForecastPosts.push(body)
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          snapshotId: 'snapshot_sim_1',
          generatedAt: '2026-03-20T12:30:00.000Z',
          teamForecasts: [
            {
              teamId: 'teamA',
              teamName: 'Alpha',
              playoffProbability: 85.1,
              firstPlaceProbability: 48.9,
              championshipProbability: 29.2,
              expectedWins: 10.9,
              expectedFinalSeed: 1.5,
              finishRange: { min: 1, max: 4 },
              eliminationRisk: 14.9,
              byeProbability: 43.8,
              confidenceScore: 80,
            },
            {
              teamId: 'teamB',
              teamName: 'Bravo',
              playoffProbability: 60.7,
              firstPlaceProbability: 19.6,
              championshipProbability: 16.1,
              expectedWins: 9.0,
              expectedFinalSeed: 2.9,
              finishRange: { min: 1, max: 6 },
              eliminationRisk: 39.3,
              byeProbability: 21.1,
              confidenceScore: 73,
            },
          ],
        }),
      })
    })

    await page.route('**/api/leagues/league_sim_1/forecast-summary', async (route) => {
      const body = route.request().postDataJSON() as Record<string, unknown>
      forecastSummaryPosts.push(body)
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          summary: 'Alpha leads the race, Bravo remains in the playoff hunt, and volatility suggests another swing week.',
        }),
      })
    })

    await page.route('**/api/leagues/league_sim_1/dynasty-projections?**', async (route) => {
      const url = new URL(route.request().url())
      const sport = url.searchParams.get('sport') ?? 'NBA'
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          sport,
          generated: false,
          generatedAt: '2026-03-20T12:35:00.000Z',
          projections: [
            {
              projectionId: 'dyn-1',
              teamId: 'teamA',
              leagueId: 'league_sim_1',
              sport,
              championshipWindowScore: 71,
              rebuildProbability: 29,
              rosterStrength3Year: 79,
              rosterStrength5Year: 74,
              agingRiskScore: 36,
              futureAssetScore: 63,
              createdAt: '2026-03-20T12:35:00.000Z',
            },
            {
              projectionId: 'dyn-2',
              teamId: 'teamB',
              leagueId: 'league_sim_1',
              sport,
              championshipWindowScore: 49,
              rebuildProbability: 52,
              rosterStrength3Year: 66,
              rosterStrength5Year: 69,
              agingRiskScore: 44,
              futureAssetScore: 70,
              createdAt: '2026-03-20T12:35:00.000Z',
            },
          ],
        }),
      })
    })

    await page.route('**/api/app/league/league_sim_1/matchups**', async (route) => {
      const url = new URL(route.request().url())
      const week = url.searchParams.get('week')
      matchupsApiCalls.push({ week })
      const selected = week ? Number(week) : 1
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          sport: 'NBA',
          label: 'week',
          selectedWeekOrRound: selected,
          totalWeeksOrRounds: 5,
          availableWeeks: [1, 2, 3, 4, 5],
          matchups: [
            {
              id: `m-${selected}`,
              teamAId: 'teamA',
              teamBId: 'teamB',
              teamAName: 'Alpha',
              teamBName: 'Bravo',
              scoreA: 111.4,
              scoreB: 104.7,
              projA: 120.3,
              projB: 116.1,
              winProbA: 0.61,
              remainingA: 2,
              remainingB: 3,
              weekOrRound: selected,
            },
          ],
        }),
      })
    })

    await page.route('**/api/leagues/league_sim_1/matchups**', async (route) => {
      const url = new URL(route.request().url())
      const week = url.searchParams.get('week')
      matchupsApiCalls.push({ week })
      const selected = week ? Number(week) : 1
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          sport: 'NBA',
          season: 2026,
          label: 'week',
          selectedWeekOrRound: selected,
          totalWeeksOrRounds: 5,
          availableWeeks: [1, 2, 3, 4, 5],
          matchups: [
            {
              id: `m-${selected}`,
              teamAId: 'teamA',
              teamBId: 'teamB',
              teamAName: 'Alpha',
              teamBName: 'Bravo',
              scoreA: 111.4,
              scoreB: 104.7,
              projA: 120.3,
              projB: 116.1,
              winProbA: 0.61,
              remainingA: 2,
              remainingB: 3,
              weekOrRound: selected,
            },
          ],
        }),
      })
    })

    await page.goto('/app/matchup-simulation')
    const openSimulatorButton = page.getByTestId('matchup-open-simulator')
    if (await openSimulatorButton.isVisible().catch(() => false)) {
      await openSimulatorButton.click()
    }
    await page.getByTestId('matchup-compare-button').click()
    await expect(page.locator('[data-audit="win-probability-meter"]')).toBeVisible()
    const matchupExplainLink = page.getByRole('link', { name: /Ask Chimmy to explain this matchup/i })
    await expect(matchupExplainLink).toBeVisible()
    await expect(matchupExplainLink).toHaveAttribute('href', /insightType=matchup/)
    await page.getByRole('button', { name: 'Rerun simulation' }).click()

    await page.goto('/app/simulation-lab')
    await page.getByLabel('Season simulation sport').selectOption('SOCCER')
    await page.getByRole('button', { name: 'Run season simulation' }).click()
    await expect(page.getByText('Sport: SOCCER')).toBeVisible()

    await page.getByRole('button', { name: 'Playoffs' }).click()
    await page.getByLabel('Playoff simulation sport').selectOption('NCAAF')
    await page.getByRole('button', { name: 'Run playoff simulation' }).click()
    await expect(page.getByText('Sport: NCAAF')).toBeVisible()

    await page.getByRole('button', { name: 'Dynasty' }).click()
    await page.getByLabel('Dynasty simulation sport').selectOption('NBA')
    await page.getByRole('button', { name: 'Run dynasty simulation' }).click()
    await expect(page.getByText('Sport: NBA')).toBeVisible()

    // /leagues/<id> shows a sign-in wall to a settled-unauthenticated session since
    // 1f5105f6 (every fetch on that page is session-gated). The mocked league APIs
    // still answer; the visitor just has to be signed in to reach the tab.
    await signInAs(page, { id: 'e2e-simulation-user' })
    await page.goto('/leagues/league_sim_1?tab=Standings%2FPlayoffs')
    await expect(page.getByRole('heading', { name: 'Season & playoff forecast' }).first()).toBeVisible()
    await page.getByLabel('Season simulation selector').fill('2027')
    await page.getByLabel('Week simulation selector').fill('5')
    await page.getByLabel('Simulation count selector').selectOption('3000')
    await page.getByLabel('Playoff spots selector').fill('4')
    await page.getByRole('button', { name: 'Apply' }).click()
    await page.getByRole('button', { name: 'Rerun season simulation' }).click()
    await page.getByRole('button', { name: 'Explain season simulation with Chimmy' }).click()
    await expect(page.getByText(/Alpha leads the race/i)).toBeVisible()
    const playoffChatLink = page.getByRole('link', { name: 'Ask Chimmy about playoff odds →' })
    await expect(playoffChatLink).toHaveAttribute('href', /leagueId=league_sim_1/)
    await expect(playoffChatLink).toHaveAttribute('href', /insightType=playoff/)
    const explainCardLinks = page.getByRole('link', { name: /Explain playoff odds for/i })
    await expect(explainCardLinks.first()).toBeVisible()
    await expect(explainCardLinks.first()).toHaveAttribute('href', /insightType=playoff/)
    await page.getByLabel('Team comparison selector A').selectOption('teamA')
    await page.getByLabel('Team comparison selector B').selectOption('teamB')
    await expect(page.getByText(/Playoff delta:/i)).toBeVisible()
    await expect(page.getByRole('button', { name: 'Refresh League Data' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Back to Leagues' })).toBeVisible()

    await page.goto('/e2e/matchups?leagueId=league_sim_1')
    await expect(page.getByText('E2E Matchups Harness')).toBeVisible()
    await page.getByLabel('Matchup period selector').selectOption('2')
    await page.getByRole('button', { name: /Sim My Matchup|Rerun Simulation/ }).first().click()

    expect(matchupRequests.length).toBeGreaterThan(2)
    expect(matchupRequests.some((r) => r.sport === 'NBA' && r.leagueId === 'league_sim_1' && r.persist === true)).toBe(true)
    expect(matchupRequests.some((r) => r.sport === 'NFL')).toBe(true)

    expect(seasonLabRequests.some((r) => r.sport === 'SOCCER')).toBe(true)
    expect(playoffLabRequests.some((r) => r.sport === 'NCAAF')).toBe(true)
    expect(dynastyLabRequests.some((r) => r.sport === 'NBA')).toBe(true)

    expect(seasonForecastGets.some((r) => r.season === '2027' && r.week === '5')).toBe(true)
    expect(seasonForecastPosts.some((r) => r.season === 2027 && r.week === 5 && r.simulations === 3000 && r.playoffSpots === 4)).toBe(true)
    expect(forecastSummaryPosts.length).toBeGreaterThan(0)
    expect(matchupsApiCalls.length).toBeGreaterThan(0)
  })
})


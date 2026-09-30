import { expect, test } from '@playwright/test'

test.describe.configure({ timeout: 180_000 })

test.describe('@dynasty full click audit', () => {
  test('audits dynasty projections, selectors, toggles, AI advice, and context links', async ({ page }) => {
    const dynastyProjectionGets: Array<{ sport: string; refresh: string | null }> = []
    const dynastyAdvicePosts: Array<Record<string, unknown>> = []
    const dynastyInsightsGets: Array<{ sport: string | null; ai: string | null }> = []

    await page.route('**/api/legacy/identity', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ identity: { recommendedUserId: 'user-dyn-1', source: 'e2e' } }),
      })
    })

    await page.route('**/api/bracket/my-leagues', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          leagues: [
            {
              id: 'league_dyn_1',
              name: 'Dynasty League',
              sport: 'NFL',
              _count: { members: 12, entries: 12 },
            },
          ],
        }),
      })
    })

    await page.route('**/api/bracket/leagues/league_dyn_1/standings', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          standings: [
            { entryId: 'teamA', entryName: 'Alpha', ownerName: 'A', points: 960, picksCount: 120, rank: 1 },
            { entryId: 'teamB', entryName: 'Bravo', ownerName: 'B', points: 900, picksCount: 118, rank: 2 },
            { entryId: 'teamC', entryName: 'Charlie', ownerName: 'C', points: 870, picksCount: 116, rank: 3 },
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
    await page.route('**/api/bracket/leagues/league_dyn_1/chat', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ messages: [] }) })
    })

    await page.route('**/api/leagues/league_dyn_1/season-forecast?**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ generated: false, teamForecasts: null }),
      })
    })
    await page.route('**/api/leagues/league_dyn_1/season-forecast', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ generated: false, teamForecasts: null }),
      })
    })
    await page.route('**/api/leagues/league_dyn_1/forecast-summary', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ summary: 'No forecast summary.' }),
      })
    })

    await page.route('**/api/leagues/league_dyn_1/dynasty-projections?**', async (route) => {
      const url = new URL(route.request().url())
      const sport = url.searchParams.get('sport') ?? 'NFL'
      const refresh = url.searchParams.get('refresh')
      dynastyProjectionGets.push({ sport, refresh })
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          sport,
          generated: Boolean(refresh),
          generatedAt: '2026-03-20T15:00:00.000Z',
          projections: [
            {
              projectionId: 'dyn_a',
              teamId: 'teamA',
              leagueId: 'league_dyn_1',
              sport,
              championshipWindowScore: 78,
              rebuildProbability: 21,
              rosterStrength3Year: 82,
              rosterStrength5Year: 75,
              agingRiskScore: 38,
              futureAssetScore: 64,
              createdAt: '2026-03-20T15:00:00.000Z',
            },
            {
              projectionId: 'dyn_b',
              teamId: 'teamB',
              leagueId: 'league_dyn_1',
              sport,
              championshipWindowScore: 52,
              rebuildProbability: 49,
              rosterStrength3Year: 68,
              rosterStrength5Year: 71,
              agingRiskScore: 44,
              futureAssetScore: 72,
              createdAt: '2026-03-20T15:00:00.000Z',
            },
            {
              projectionId: 'dyn_c',
              teamId: 'teamC',
              leagueId: 'league_dyn_1',
              sport,
              championshipWindowScore: 33,
              rebuildProbability: 67,
              rosterStrength3Year: 51,
              rosterStrength5Year: 58,
              agingRiskScore: 56,
              futureAssetScore: 79,
              createdAt: '2026-03-20T15:00:00.000Z',
            },
          ],
        }),
      })
    })

    await page.route('**/api/dynasty-outlook', async (route) => {
      const body = route.request().postDataJSON() as Record<string, unknown>
      dynastyAdvicePosts.push(body)
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          analysis: {
            overallOutlook: 'Alpha has a stable contender window with room to improve long-term RB depth.',
            contenderOrRebuilder: 'contender',
            keyRecommendation: 'Move one aging scorer for a future first and a younger starter.',
            confidence: 83,
          },
        }),
      })
    })

    await page.route('**/api/dynasty-intelligence?**', async (route) => {
      const url = new URL(route.request().url())
      dynastyInsightsGets.push({
        sport: url.searchParams.get('sport'),
        ai: url.searchParams.get('ai'),
      })
      const includeAI = url.searchParams.get('ai') === '1' || url.searchParams.get('ai') === 'true'
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: {
            sport: url.searchParams.get('sport') ?? 'NFL',
            position: url.searchParams.get('position') ?? 'WR',
            age: Number(url.searchParams.get('age') ?? 25),
            currentValue: Number(url.searchParams.get('baseValue') ?? 5000),
            ageCurve: {
              sport: url.searchParams.get('sport') ?? 'NFL',
              position: url.searchParams.get('position') ?? 'WR',
              peakAgeStart: 25,
              peakAgeEnd: 29,
              points: [
                { age: 23, multiplier: 0.93, label: null },
                { age: 25, multiplier: 1, label: 'Peak start' },
                { age: 29, multiplier: 1, label: 'Peak end' },
                { age: 33, multiplier: 0.58, label: 'Cliff' },
              ],
            },
            marketValueTrend: {
              direction: 'up',
              trendScore: 64.2,
              scoreDelta: 4.5,
              usageChange: 0.12,
              updatedAt: '2026-03-20T12:00:00.000Z',
            },
            careerTrajectory: {
              sport: url.searchParams.get('sport') ?? 'NFL',
              position: url.searchParams.get('position') ?? 'WR',
              age: Number(url.searchParams.get('age') ?? 25),
              baseValue: Number(url.searchParams.get('baseValue') ?? 5000),
              expectedWindowYears: 4,
              points: [
                { yearOffset: 0, projectedValue: 5000, ageMultiplier: 1, windowYears: 4 },
                { yearOffset: 1, projectedValue: 4900, ageMultiplier: 0.98, windowYears: 4 },
                { yearOffset: 2, projectedValue: 4700, ageMultiplier: 0.94, windowYears: 3 },
              ],
            },
          },
          insight: includeAI
            ? {
                mathValidation: 'Inputs are internally consistent.',
                narrative: 'This profile is an above-market hold with upside.',
                explanation: 'Age curve and trend support patience in dynasty formats.',
              }
            : undefined,
        }),
      })
    })

    await page.goto('/leagues/league_dyn_1?tab=Standings%2FPlayoffs')
    await page.getByRole('button', { name: 'Standings/Playoffs' }).click()
    await expect(page.getByRole('heading', { name: 'Dynasty projections' })).toBeVisible()

    await page.getByLabel('Dynasty sport filter').selectOption('NCAAB')
    await page.getByRole('button', { name: 'Refresh dynasty projections' }).click()
    await page.getByRole('button', { name: 'Show 5-year dynasty outlook' }).click()
    await page.getByRole('button', { name: 'Show 3-year dynasty outlook' }).click()
    await page.getByLabel('Dynasty team selector').selectOption('teamB')
    await page.getByLabel('Dynasty comparison selector A').selectOption('teamA')
    await page.getByLabel('Dynasty comparison selector B').selectOption('teamC')
    await page.getByRole('button', { name: "Get Chimmy's dynasty advice" }).click()
    await expect(page.getByText(/Move one aging scorer/i)).toBeVisible()
    await expect(page.getByRole('link', { name: 'Open trade analyzer with dynasty context' })).toHaveAttribute(
      'href',
      /context=dynasty/
    )
    await page.getByRole('button', { name: 'Back to league overview' }).click()
    await expect(page.getByRole('heading', { name: 'League Snapshot' })).toBeVisible()

    await page.goto('/app/dynasty-insights')
    await page.getByLabel('Dynasty insights sport filter').selectOption('SOCCER')
    await page.getByLabel('Dynasty insights position filter').selectOption('FWD')
    await page.getByRole('button', { name: "Get Chimmy's dynasty insights" }).click()
    await expect(page.getByText(/Age curve \(SOCCER FWD\)/i)).toBeVisible()
    await expect(page.getByRole('heading', { name: "Chimmy's insight" })).toBeVisible()

    expect(dynastyProjectionGets.some((r) => r.sport === 'NCAAB')).toBe(true)
    expect(dynastyProjectionGets.some((r) => r.refresh === '1')).toBe(true)
    expect(dynastyAdvicePosts.some((p) => p.leagueId === 'league_dyn_1' && p.teamId === 'teamB')).toBe(true)
    expect(dynastyInsightsGets.some((r) => r.sport === 'SOCCER')).toBe(true)
    expect(dynastyInsightsGets.some((r) => r.ai === '1')).toBe(true)
  })
})


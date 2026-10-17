import { expect, test } from '@playwright/test'

test.describe.configure({ timeout: 180_000 })

function buildStrategyRows(sport: string, leagueFormat: string) {
  const isNhl = sport === 'NHL'
  return [
    {
      strategyType: isNhl ? 'GoaliePitcherHeavyBuild' : 'ZeroRB',
      strategyLabel: isNhl ? 'Goalie-heavy build' : sport === 'SOCCER' ? 'Zero FWD' : 'Zero RB / Defer primary',
      sport,
      usageRate: 0.34,
      successRate: 0.58,
      trendingDirection: 'Rising',
      leagueFormat: leagueFormat || 'dynasty_sf',
      sampleSize: 112,
    },
    {
      strategyType: 'BalancedBuild',
      strategyLabel: 'Balanced build',
      sport,
      usageRate: 0.29,
      successRate: 0.55,
      trendingDirection: 'Stable',
      leagueFormat: leagueFormat || 'dynasty_sf',
      sampleSize: 98,
    },
  ]
}

test.describe('@strategy-meta click audit', () => {
  test('audits strategy dashboard, filters, tabs, details, and links', async ({ page }) => {
    const strategyRequests: Array<{ sport: string; timeframe: string; leagueFormat: string }> = []
    const metaAnalysisRequests: Array<{ sport: string; timeframe: string; leagueFormat: string }> = []

    await page.route('**/api/player-trend?**', async (route) => {
      const url = new URL(route.request().url())
      const sport = url.searchParams.get('sport') ?? 'NFL'
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          list: url.searchParams.get('list') ?? 'hottest',
          sport,
          data: [
            {
              playerId: `${sport}-p1`,
              sport,
              trendScore: 82,
              trendingDirection: 'Rising',
            },
          ],
        }),
      })
    })

    await page.route('**/api/global-meta?**', async (route) => {
      const url = new URL(route.request().url())
      const sport = url.searchParams.get('sport') ?? 'NFL'
      const timeframe = url.searchParams.get('timeframe') ?? '7d'
      if (url.searchParams.get('summary') === 'ai') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            data: {
              summary: `Strategy AI summary for ${sport} (${timeframe})`,
              topTrends: [`${sport} trend alpha`, `${sport} trend beta`],
            },
          }),
        })
        return
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: [{ metaType: 'StrategyMeta', data: { sport, timeframe } }],
        }),
      })
    })

    await page.route('**/api/strategy-meta?**', async (route) => {
      const url = new URL(route.request().url())
      const sport = url.searchParams.get('sport') ?? 'NFL'
      const timeframe = url.searchParams.get('timeframe') ?? '7d'
      const leagueFormat = url.searchParams.get('leagueFormat') ?? ''
      strategyRequests.push({ sport, timeframe, leagueFormat })
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: buildStrategyRows(sport, leagueFormat),
        }),
      })
    })

    await page.route('**/api/meta-analysis?**', async (route) => {
      const url = new URL(route.request().url())
      const sport = url.searchParams.get('sport') ?? 'NFL'
      const timeframe = url.searchParams.get('timeframe') ?? '30d'
      const leagueFormat = url.searchParams.get('leagueFormat') ?? ''
      metaAnalysisRequests.push({ sport, timeframe, leagueFormat })
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          sport,
          generatedAt: '2026-03-20T00:00:00.000Z',
          draftStrategyShifts: buildStrategyRows(sport, leagueFormat).map((row) => ({
            strategyType: row.strategyType,
            strategyLabel: row.strategyLabel,
            sport: row.sport,
            leagueFormat: row.leagueFormat,
            usageRate: row.usageRate,
            successRate: row.successRate,
            trendingDirection: row.trendingDirection,
            sampleSize: row.sampleSize,
            shiftLabel: row.trendingDirection === 'Rising' ? 'Usage rising' : 'Stable',
          })),
          positionValueChanges: [
            {
              position: sport === 'NHL' ? 'G' : 'RB',
              sport,
              avgValueGiven: 6.2,
              avgValueReceived: 6.9,
              sampleSize: 38,
              marketTrend: 'Rising',
              direction: 'Rising',
            },
          ],
          waiverStrategyTrends: [
            {
              sport,
              addCount: 16,
              dropCount: 10,
              windowDays: timeframe === '24h' ? 1 : timeframe === '7d' ? 7 : 30,
              netAdds: 6,
              addRatePerDay: 2.3,
              dropRatePerDay: 1.4,
            },
          ],
        }),
      })
    })

    await page.goto('/app/meta-insights')
    await expect(page.getByRole('heading', { name: 'Meta insights' })).toBeVisible({ timeout: 45_000 })
    await page.getByRole('combobox', { name: 'Sport filter' }).selectOption('SOCCER')
    await page.getByRole('combobox', { name: 'Timeframe filter' }).selectOption('30d')
    await page.getByRole('button', { name: 'Refresh' }).click()
    await expect(page.getByRole('cell', { name: 'Zero FWD', exact: true })).toBeVisible()
    await page
      .getByRole('row', { name: /Zero FWD/ })
      .getByRole('button', { name: /View strategy details for ZeroRB/i })
      .click()
    await expect(page.getByRole('dialog', { name: 'Strategy details' })).toContainText('Zero FWD')
    await page.getByRole('button', { name: 'Close strategy details' }).click()
    await expect(page.getByRole('button', { name: 'Show success rate' })).toHaveCount(0)
    await page.getByRole('button', { name: 'Hide success rate' }).click()
    await expect(page.getByRole('button', { name: 'Show success rate' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Strategy dashboard' })).toHaveAttribute(
      'href',
      '/app/strategy-meta?sport=SOCCER&timeframe=30d'
    )
    await page.getByRole('button', { name: 'Explain this trend' }).click()
    await expect(page.getByRole('dialog', { name: "Chimmy's trend explanation" })).toContainText(
      'Strategy AI summary for SOCCER (30d)'
    )

    await page.goto('/app/strategy-meta?sport=NHL&timeframe=24h')
    await expect(page.getByRole('heading', { name: 'Strategy meta dashboard' })).toBeVisible()
    await expect(page.getByRole('combobox', { name: 'Sport' })).toHaveValue('NHL')
    await expect(page.getByRole('combobox', { name: 'Timeframe' })).toHaveValue('24h')
    await expect(page.getByRole('button', { name: 'Draft strategy widgets' })).toBeVisible()
    await page.getByRole('button', { name: /View strategy details for GoaliePitcherHeavyBuild/i }).click()
    await expect(page.getByRole('dialog', { name: 'Strategy details' })).toContainText('Goalie-heavy build')
    await page.getByRole('button', { name: 'Close strategy details' }).click()
    await page.getByRole('button', { name: 'Roster strategy widgets' }).click()
    await expect(page.getByRole('heading', { name: 'Roster strategy value shifts' })).toBeVisible()
    await page.getByRole('button', { name: 'Draft strategy widgets' }).click()
    await page.getByRole('button', { name: 'Hide success rate graph' }).click()
    await expect(page.getByRole('button', { name: 'Show success rate graph' })).toBeVisible()
    await page.getByRole('button', { name: 'Refresh' }).click()
    await page.getByRole('button', { name: /View strategy details for GoaliePitcherHeavyBuild/i }).click()
    await expect(page.getByRole('link', { name: 'Open mock draft context' })).toHaveAttribute(
      'href',
      '/mock-draft-simulator?sport=NHL'
    )

    expect(strategyRequests.some((r) => r.sport === 'SOCCER' && r.timeframe === '30d')).toBe(true)
    expect(metaAnalysisRequests.some((r) => r.sport === 'NHL' && r.timeframe === '24h')).toBe(true)
  })
})


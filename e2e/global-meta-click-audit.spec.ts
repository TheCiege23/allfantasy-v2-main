import { expect, test } from '@playwright/test'

test.describe.configure({ timeout: 180_000 })

function buildTrendRows(sport: string, prefix: string) {
  return Array.from({ length: 8 }).map((_, idx) => ({
    playerId: `${prefix}-player-${idx + 1}`,
    sport,
    trendScore: 80 - idx * 3,
    trendingDirection: idx % 2 === 0 ? 'Rising' : 'Hot',
    addRate: 1.2,
    dropRate: 0.4,
    tradeInterest: 0.3,
    draftFrequency: 0.5,
    lineupStartRate: 0.65,
    injuryImpact: 0.05,
    updatedAt: new Date('2026-03-21T00:00:00.000Z').toISOString(),
  }))
}

test.describe('@meta global meta click audit', () => {
  test('audits filters, tabs, toggles, refresh, AI explain, and error recovery', async ({ page }) => {
    const playerTrendRequests: Array<{ sport: string; list: string; timeframe: string }> = []
    const strategyRequests: Array<{ sport: string; timeframe: string; leagueFormat: string }> = []
    const snapshotRequests: Array<{ sport: string; timeframe: string; metaType: string; summary: string | null }> = []

    let firstStrategyCall = true

    await page.route('**/api/player-trend?**', async (route) => {
      const url = new URL(route.request().url())
      const list = url.searchParams.get('list') ?? 'hottest'
      const sport = url.searchParams.get('sport') ?? 'NFL'
      const timeframe = url.searchParams.get('timeframe') ?? '7d'
      playerTrendRequests.push({ sport, list, timeframe })
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          list,
          sport,
          data: buildTrendRows(sport, list),
        }),
      })
    })

    await page.route('**/api/strategy-meta?**', async (route) => {
      const url = new URL(route.request().url())
      const sport = url.searchParams.get('sport') ?? 'NFL'
      const timeframe = url.searchParams.get('timeframe') ?? '7d'
      const leagueFormat = url.searchParams.get('leagueFormat') ?? ''
      strategyRequests.push({ sport, timeframe, leagueFormat })

      if (firstStrategyCall && leagueFormat === 'dynasty_sf') {
        firstStrategyCall = false
        await route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'Strategy backend unavailable (audit injection)' }),
        })
        return
      }

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: [
            {
              strategyType: 'ZeroRB',
              sport,
              usageRate: 0.33,
              successRate: 0.59,
              trendingDirection: 'Rising',
              leagueFormat: leagueFormat || 'dynasty_sf',
              sampleSize: 120,
            },
            {
              strategyType: 'HeroRB',
              sport,
              usageRate: 0.27,
              successRate: 0.56,
              trendingDirection: 'Stable',
              leagueFormat: leagueFormat || 'dynasty_sf',
              sampleSize: 95,
            },
          ],
        }),
      })
    })

    await page.route('**/api/global-meta?**', async (route) => {
      const url = new URL(route.request().url())
      const sport = url.searchParams.get('sport') ?? 'NFL'
      const timeframe = url.searchParams.get('timeframe') ?? '7d'
      const metaType = url.searchParams.get('metaType') ?? ''
      const summary = url.searchParams.get('summary')
      snapshotRequests.push({ sport, timeframe, metaType, summary })

      if (summary === 'ai') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            data: {
              summary: `AI summary for ${sport} (${timeframe})`,
              topTrends: [
                `${sport} trend alpha`,
                `${sport} trend beta`,
                `${sport} trend gamma`,
              ],
              sportContext: `Sport: ${sport}`,
            },
          }),
        })
        return
      }

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: [
            {
              metaType,
              data: {
                totalEvents: 42,
                generatedAt: '2026-03-21T00:00:00.000Z',
                sport,
                timeframe,
              },
            },
          ],
        }),
      })
    })

    await page.goto('/app/meta-insights?sport=NCAAB&timeframe=24h&tab=trade&leagueFormat=dynasty_sf')
    await expect(page.getByRole('heading', { name: 'Meta insights' })).toBeVisible({ timeout: 45_000 })
    await expect(page.getByRole('combobox', { name: 'Sport filter' })).toHaveValue('NCAAB')
    await expect(page.getByRole('combobox', { name: 'Timeframe filter' })).toHaveValue('24h')
    await expect(page.getByRole('combobox', { name: 'League format (strategy)' })).toHaveValue('dynasty_sf')
    await expect(page.getByRole('heading', { name: 'TradeMeta snapshot' })).toBeVisible()

    // Strategy panel starts in error due to first injected failure.
    await expect(page.getByText('Strategy backend unavailable (audit injection)')).toBeVisible()

    // Refresh must refetch strategy + war room and recover from the injected error.
    await page.getByRole('button', { name: 'Refresh' }).click()
    await expect(page.getByRole('cell', { name: 'ZeroRB', exact: true })).toBeVisible()
    // Renamed by the AF Legacy rebrand — the widget is still WarRoomMetaWidget in code.
    await expect(page.getByRole('heading', { name: 'AF Legacy meta' })).toBeVisible()

    // Tabs drive snapshot metaType fetches.
    await page.getByRole('button', { name: 'Draft meta' }).click()
    await expect(page.getByRole('heading', { name: 'DraftMeta snapshot' })).toBeVisible()
    await page.getByRole('button', { name: 'Waiver meta' }).click()
    await expect(page.getByRole('heading', { name: 'WaiverMeta snapshot' })).toBeVisible()
    await page.getByRole('button', { name: 'Trade meta' }).click()
    await expect(page.getByRole('heading', { name: 'TradeMeta snapshot' })).toBeVisible()
    await page.getByRole('button', { name: 'Roster meta' }).click()
    await expect(page.getByRole('heading', { name: 'RosterMeta snapshot' })).toBeVisible()
    await page.getByRole('button', { name: 'Strategy meta' }).click()
    await expect(page.getByRole('heading', { name: 'StrategyMeta snapshot' })).toBeVisible()

    // Sport/timeframe filters propagate through panel API calls.
    await page.getByRole('combobox', { name: 'Sport filter' }).selectOption('SOCCER')
    await page.getByRole('combobox', { name: 'Timeframe filter' }).selectOption('30d')
    await expect(page.getByRole('cell', { name: 'ZeroRB', exact: true })).toBeVisible()

    // Player trend details and close action.
    await page.getByRole('button', { name: /View trend details for hottest-player-1/i }).first().click()
    await expect(page.getByRole('dialog', { name: 'Trend details' })).toBeVisible()
    await page.getByRole('button', { name: 'Close trend details' }).click()
    await expect(page.getByRole('dialog', { name: 'Trend details' })).toHaveCount(0)

    // Strategy detail toggle and close action.
    await page
      .getByRole('row', { name: /ZeroRB/ })
      .getByRole('button', { name: /View strategy details for ZeroRB/i })
      .click()
    await expect(page.getByRole('dialog', { name: 'Strategy details' })).toBeVisible()
    await page.getByRole('button', { name: 'Close strategy details' }).click()
    await expect(page.getByRole('dialog', { name: 'Strategy details' })).toHaveCount(0)

    // Chart toggle and add/drop toggle handlers.
    await page.getByRole('button', { name: 'Hide success rate' }).click()
    await expect(page.getByRole('button', { name: 'Show success rate' })).toBeVisible()
    await page.getByRole('button', { name: 'Show add/drop rates' }).first().click()
    await expect(page.getByRole('button', { name: 'Hide add/drop rates' }).first()).toBeVisible()

    // AI explain button opens, loads, then closes.
    await page.getByRole('button', { name: 'Explain this trend' }).click()
    await expect(page.getByRole('dialog', { name: 'AI trend explanation' })).toContainText('AI summary for SOCCER (30d)')
    await page.getByRole('button', { name: 'Explain this trend' }).click()
    await expect(page.getByRole('dialog', { name: 'AI trend explanation' })).toHaveCount(0)

    // Link entry points remain wired.
    await expect(page.getByRole('link', { name: 'Leagues' })).toHaveAttribute('href', '/leagues')
    await expect(page.getByRole('link', { name: 'Meta Insights' }).first()).toHaveAttribute('href', '/app/meta-insights')
    await expect(page.getByRole('link', { name: 'Waiver AI' }).first()).toHaveAttribute('href', '/waiver-ai')
    await expect(page.getByRole('link', { name: 'Mock draft' }).first()).toHaveAttribute('href', '/mock-draft-simulator')

    expect(playerTrendRequests.some((r) => r.sport === 'SOCCER' && r.timeframe === '30d')).toBe(true)
    expect(strategyRequests.some((r) => r.sport === 'SOCCER' && r.timeframe === '30d')).toBe(true)
    expect(
      snapshotRequests.some(
        (r) => r.sport === 'SOCCER' && r.timeframe === '30d' && r.metaType === 'StrategyMeta'
      )
    ).toBe(true)
    expect(snapshotRequests.some((r) => r.summary === 'ai' && r.sport === 'SOCCER')).toBe(true)
  })
})

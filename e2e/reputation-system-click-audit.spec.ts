import { expect, test } from '@playwright/test'

test.describe.configure({ timeout: 180_000 })

test.describe('@reputation reputation system click audit', () => {
  test('wires filters, config, explain, evidence drill-down, compare, and run actions', async ({ page }) => {
    const leagueId = `e2e-reputation-${Date.now()}`
    const season = 2026

    let configState = {
      sport: 'NFL',
      season,
      tierThresholds: {
        Legendary: { min: 90 },
        Elite: { min: 75, max: 89 },
        Trusted: { min: 60, max: 74 },
        Reliable: { min: 45, max: 59 },
        Neutral: { min: 25, max: 44 },
        Risky: { min: 0, max: 24 },
      },
      scoreWeights: {
        reliability: 1.2,
        activity: 1,
        tradeFairness: 1.2,
        sportsmanship: 1,
        commissionerTrust: 1.1,
        toxicityRisk: 1.2,
        participationQuality: 1,
        responsiveness: 0.8,
      },
    }

    let reputationsState = [
      {
        managerId: 'mgr_1',
        sport: 'NFL',
        season,
        tier: 'Trusted',
        overallScore: 71,
        reliabilityScore: 70,
        activityScore: 74,
        tradeFairnessScore: 76,
        sportsmanshipScore: 68,
        commissionerTrustScore: 73,
        toxicityRiskScore: 19,
        participationQualityScore: 72,
        responsivenessScore: 69,
        updatedAt: new Date().toISOString(),
      },
      {
        managerId: 'mgr_2',
        sport: 'NFL',
        season,
        tier: 'Reliable',
        overallScore: 58,
        reliabilityScore: 57,
        activityScore: 63,
        tradeFairnessScore: 61,
        sportsmanshipScore: 55,
        commissionerTrustScore: 60,
        toxicityRiskScore: 29,
        participationQualityScore: 60,
        responsivenessScore: 52,
        updatedAt: new Date().toISOString(),
      },
    ]

    const configPatches: Array<Record<string, unknown>> = []
    const runPosts: Array<Record<string, unknown>> = []
    const explainPosts: Array<Record<string, unknown>> = []
    const compareHits: string[] = []

    await page.route(`**/api/leagues/${leagueId}/reputation?**`, async (route) => {
      const url = new URL(route.request().url())
      const sport = url.searchParams.get('sport') || 'NFL'
      const tier = url.searchParams.get('tier') || ''
      const seasonParam = Number.parseInt(url.searchParams.get('season') || `${season}`, 10)
      const scoped = reputationsState.filter((row) => {
        const matchSport = row.sport === sport
        const matchSeason = Number.isFinite(seasonParam) ? row.season === seasonParam : true
        const matchTier = tier ? row.tier === tier : true
        return matchSport && matchSeason && matchTier
      })
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ leagueId, reputations: scoped }),
      })
    })
    await page.route(`**/api/leagues/${leagueId}/reputation/config?**`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ leagueId, config: configState }),
      })
    })
    await page.route(`**/api/leagues/${leagueId}/reputation/config`, async (route) => {
      const payload = route.request().postDataJSON() as Record<string, unknown>
      configPatches.push(payload)
      configState = {
        ...configState,
        sport: String(payload.sport || configState.sport),
        season:
          typeof payload.season === 'number'
            ? payload.season
            : Number.parseInt(String(payload.season || configState.season), 10),
        tierThresholds: (payload.tierThresholds as typeof configState.tierThresholds) || configState.tierThresholds,
        scoreWeights: (payload.scoreWeights as typeof configState.scoreWeights) || configState.scoreWeights,
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ leagueId, config: configState }),
      })
    })
    await page.route(`**/api/leagues/${leagueId}/reputation/run`, async (route) => {
      const payload = route.request().postDataJSON() as Record<string, unknown>
      runPosts.push(payload)
      reputationsState = reputationsState.map((row) => ({
        ...row,
        sport: String(payload.sport ?? row.sport),
        season:
          typeof payload.season === 'number'
            ? payload.season
            : Number.parseInt(String(payload.season ?? row.season), 10),
      }))
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          leagueId,
          processed: reputationsState.length,
          created: 0,
          updated: reputationsState.length,
          results: reputationsState.map((row) => ({
            managerId: row.managerId,
            tier: row.tier,
            overallScore: row.overallScore,
          })),
        }),
      })
    })
    await page.route(`**/api/leagues/${leagueId}/reputation/explain`, async (route) => {
      const payload = route.request().postDataJSON() as Record<string, unknown>
      explainPosts.push(payload)
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          narrative:
            'Manager reputation is trusted because activity and trade fairness are above league baseline while toxicity risk remains low.',
        }),
      })
    })
    await page.route(`**/api/leagues/${leagueId}/reputation/evidence?**`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          leagueId,
          managerId: 'mgr_1',
          evidence: [
            {
              id: 'ev_1',
              managerId: 'mgr_1',
              sport: 'NFL',
              season,
              evidenceType: 'trade_fair_offers',
              value: 78,
              sourceReference: 'derived:trade_fairness',
              createdAt: new Date().toISOString(),
            },
          ],
        }),
      })
    })
    await page.route(`**/api/leagues/${leagueId}/reputation/compare?**`, async (route) => {
      compareHits.push(route.request().url())
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          leagueId,
          comparison: {
            managerA: reputationsState[0],
            managerB: reputationsState[1],
          },
        }),
      })
    })
    await page.route(`**/api/leagues/${leagueId}/prestige-context?**`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          commissionerContext: {
            lowTrustManagerIds: ['mgr_2'],
            highCommissionerTrustManagerIds: ['mgr_1'],
            reputationCoverageCount: 2,
          },
        }),
      })
    })

    await page.goto(`/e2e/reputation?leagueId=${leagueId}`)
    await expect(page.getByRole('heading', { name: /e2e reputation harness/i })).toBeVisible()
    await expect(page.getByRole('heading', { name: /reputation system/i })).toBeVisible()
    await expect(page.getByText(/commissioner trust context/i)).toBeVisible()

    await page.getByTestId('reputation-sport-filter').selectOption('NFL')
    await page.getByTestId('reputation-season-filter').fill(`${season}`)
    await page.getByTestId('reputation-tier-filter').selectOption('Trusted')
    await page.getByTestId('reputation-refresh').click()
    await expect(page.locator('article').filter({ hasText: 'mgr_1' }).first()).toBeVisible()

    await page.getByTestId('reputation-run-engine').click()
    await expect.poll(() => runPosts.length).toBeGreaterThan(0)

    await page.getByRole('button', { name: /explain with chimmy/i }).first().click()
    await expect.poll(() => explainPosts.length).toBeGreaterThan(0)
    await expect(page.getByText(/activity and trade fairness are above/i)).toBeVisible()
    await expect(page.getByText(/evidence items loaded: 1/i)).toBeVisible()

    await page.getByTestId('reputation-tier-filter').selectOption('')
    await page.getByTestId('reputation-refresh').click()
    await expect(page.locator('article').filter({ hasText: 'mgr_2' }).first()).toBeVisible()

    await page.getByTestId('reputation-compare-run').click()
    await expect.poll(() => compareHits.length).toBeGreaterThan(0)
    await expect(page.getByText(/trade fairness 76/i).first()).toBeVisible()

    await page.getByTestId('reputation-save-config').click()
    await expect.poll(() => configPatches.length).toBeGreaterThan(0)
    expect(configPatches.some((payload) => payload.sport === 'NFL')).toBe(true)

    await expect(page.getByRole('link', { name: /trade fairness context/i })).toBeVisible()
    await expect(page.getByRole('link', { name: /legacy breakdown/i })).toBeVisible()
  })
})

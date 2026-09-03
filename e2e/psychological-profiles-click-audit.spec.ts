import { expect, test } from '@playwright/test'
import { signInAs } from './helpers/session-cookie'

test.describe.configure({ timeout: 180_000 })

test.describe('@psych psychological profiles click audit', () => {
  test('audits profile dashboard, detail, and comparison flows', async ({ page }) => {
    const listCalls: Array<{ sport: string | null; season: string | null }> = []
    const runAllBodies: Array<Record<string, unknown>> = []
    const explainBodies: Array<Record<string, unknown>> = []
    const compareCalls: Array<{ managerAId: string | null; managerBId: string | null; sport: string | null }> = []
    const evidenceCalls: Array<string> = []

    await page.route('**/api/leagues/league_psych_1/psychological-profiles/**', async (route) => {
      const url = route.request().url()
      const method = route.request().method()

      if (url.includes('/psychological-profiles/prof_1/evidence')) {
        evidenceCalls.push(url)
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            profileId: 'prof_1',
            leagueId: 'league_psych_1',
            evidence: [
              {
                id: 'ev_1',
                evidenceType: 'trade_frequency',
                value: 68,
                sourceReference: 'trades:9',
                createdAt: '2025-01-01T00:00:00.000Z',
              },
            ],
          }),
        })
        return
      }

      if (url.includes('/psychological-profiles/prof_1') && method === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            id: 'prof_1',
            leagueId: 'league_psych_1',
            managerId: 'mgr_alpha',
            sport: 'NBA',
            sportLabel: 'NBA',
            profileLabels: ['aggressive', 'trade-heavy', 'win-now'],
            aggressionScore: 74,
            activityScore: 69,
            tradeFrequencyScore: 72,
            waiverFocusScore: 58,
            riskToleranceScore: 66,
            evidenceCount: 5,
            evidence: [
              {
                id: 'ev_1',
                evidenceType: 'trade_frequency',
                value: 68,
                sourceReference: 'trades:9',
                createdAt: '2025-01-01T00:00:00.000Z',
              },
            ],
          }),
        })
        return
      }

      await route.fallback()
    })

    await page.route('**/api/leagues/league_psych_1/psychological-profiles/explain', async (route) => {
      if (route.request().method() === 'POST') {
        explainBodies.push(route.request().postDataJSON() as Record<string, unknown>)
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            narrative:
              'This manager pushes trades late in the season and sustains high activity, signaling a win-now style.',
          }),
        })
        return
      }
      await route.fallback()
    })

    await page.route('**/api/leagues/league_psych_1/psychological-profiles/run-all', async (route) => {
      if (route.request().method() === 'POST') {
        runAllBodies.push(route.request().postDataJSON() as Record<string, unknown>)
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            total: 2,
            success: 2,
            failed: 0,
            results: [
              { managerId: 'mgr_alpha', ok: true },
              { managerId: 'mgr_bravo', ok: true },
            ],
          }),
        })
        return
      }
      await route.fallback()
    })

    await page.route('**/api/leagues/league_psych_1/psychological-profiles**', async (route) => {
      const reqUrl = route.request().url()
      if (
        reqUrl.includes('/run-all') ||
        reqUrl.includes('/explain') ||
        reqUrl.includes('/prof_1')
      ) {
        await route.fallback()
        return
      }
      const parsed = new URL(reqUrl)
      const managerAId = parsed.searchParams.get('managerAId')
      const managerBId = parsed.searchParams.get('managerBId')
      const sport = parsed.searchParams.get('sport')
      const season = parsed.searchParams.get('season')

      if (managerAId && managerBId) {
        compareCalls.push({ managerAId, managerBId, sport })
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            comparison: {
              managerA: {
                id: 'prof_1',
                managerId: managerAId,
                sportLabel: sport ?? 'NBA',
                profileLabels: ['aggressive', 'trade-heavy'],
                aggressionScore: 74,
                activityScore: 69,
                tradeFrequencyScore: 72,
                waiverFocusScore: 58,
                riskToleranceScore: 66,
              },
              managerB: {
                id: 'prof_2',
                managerId: managerBId,
                sportLabel: sport ?? 'NBA',
                profileLabels: ['conservative', 'value-first'],
                aggressionScore: 28,
                activityScore: 35,
                tradeFrequencyScore: 22,
                waiverFocusScore: 44,
                riskToleranceScore: 26,
              },
            },
          }),
        })
        return
      }

      listCalls.push({ sport, season })
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          profiles: [
            {
              id: 'prof_1',
              managerId: 'mgr_alpha',
              sport: 'NBA',
              sportLabel: 'NBA',
              profileLabels: ['aggressive', 'trade-heavy', 'win-now'],
              aggressionScore: 74,
              activityScore: 69,
              tradeFrequencyScore: 72,
              waiverFocusScore: 58,
              riskToleranceScore: 66,
              updatedAt: '2026-03-20T00:00:00.000Z',
            },
            {
              id: 'prof_2',
              managerId: 'mgr_bravo',
              sport: 'NBA',
              sportLabel: 'NBA',
              profileLabels: ['conservative', 'value-first'],
              aggressionScore: 28,
              activityScore: 35,
              tradeFrequencyScore: 22,
              waiverFocusScore: 44,
              riskToleranceScore: 26,
              updatedAt: '2026-03-20T00:00:00.000Z',
            },
          ],
        }),
      })
    })

    /*
     * `/app/league/*` is session-gated (lib/auth/session-auth-paths.ts). The gate only
     * fires when NEXTAUTH_SECRET is set — unset locally, SET in CI — so anonymously this
     * spec passed on a developer machine and 307'd to /login on every CI run, failing as
     * "element(s) not found" rather than as a redirect. Same fix, same reason, as
     * league-drama / hall-of-fame / legacy-score.
     */
    await signInAs(page, { id: 'e2e-psych-user' })

    await page.goto('/app/league/league_psych_1/psychological-profiles')
    await expect(page.getByRole('heading', { name: 'Psychological Profiles' })).toBeVisible()
    await page.getByLabel('Behavior profile sport filter').selectOption('NBA')
    await page.getByLabel('Behavior profile season filter').fill('2025')
    await page.getByRole('button', { name: 'Refresh profiles' }).click()
    await page.getByRole('button', { name: 'Build behavior profiles' }).click()
    await expect(page.getByText(/Processed 2 managers/i)).toBeVisible()
    await page.getByRole('button', { name: 'Explain this manager style', exact: true }).first().click()
    await expect(page.getByText(/win-now style/i)).toBeVisible()

    await page.getByLabel('Behavior comparison manager A').selectOption('mgr_alpha')
    await page.getByLabel('Behavior comparison manager B').selectOption('mgr_bravo')
    await page.getByRole('link', { name: 'Compare selected managers' }).click()
    await page.waitForURL('**/psychological-profiles/compare**')
    await expect(page.getByRole('heading', { name: 'Manager Style Comparison' })).toBeVisible({
      timeout: 15000,
    })
    await page.getByLabel('Comparison sport filter').selectOption('NBA')
    await page.getByLabel('Comparison manager A').selectOption('mgr_alpha')
    await page.getByLabel('Comparison manager B').selectOption('mgr_bravo')
    await expect(page.getByText(/Manager A: mgr_alpha/i)).toBeVisible()

    await page.goto('/app/league/league_psych_1/psychological-profiles/prof_1')
    await expect(page.getByRole('heading', { name: 'Manager Psychological Profile' })).toBeVisible()
    await page.getByRole('button', { name: 'Explain this manager style' }).click()
    await expect(page.getByText(/win-now style/i)).toBeVisible()
    await page.getByLabel('Profile season filter').selectOption('2025')
    await page.getByRole('button', { name: 'Refresh evidence' }).click()
    await expect(page.getByText(/trade_frequency/i)).toBeVisible()
    await expect(page.getByRole('link', { name: 'Back' })).toBeVisible()

    expect(listCalls.length).toBeGreaterThan(0)
    expect(listCalls.some((c) => c.sport === 'NBA' && c.season === '2025')).toBe(true)
    expect(runAllBodies.length).toBeGreaterThan(0)
    expect(explainBodies.length).toBeGreaterThan(0)
    expect(compareCalls.length).toBeGreaterThan(0)
    expect(evidenceCalls.length).toBeGreaterThan(0)
  })
})

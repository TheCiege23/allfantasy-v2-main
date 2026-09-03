import { expect, test } from '@playwright/test'
import { signInAs } from './helpers/session-cookie'

test.describe.configure({ timeout: 180_000 })

test.describe('@rivalry rivalry engine click audit', () => {
  test('audits rivalry engine interactions end-to-end', async ({ page }) => {
    const rivalryListCalls: Array<{ sport: string | null; season: string | null; managerAId: string | null; managerBId: string | null }> = []
    const rivalryRunBodies: Array<Record<string, unknown>> = []
    const rivalryExplainCalls: Array<string> = []
    const rivalryTimelineCalls: Array<string> = []
    const rivalryHeadToHeadCalls: Array<string> = []

    await page.route('**/api/legacy/identity', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ identity: { recommendedUserId: 'riv-user-1', source: 'e2e' } }),
      })
    })
    await page.route('**/api/bracket/my-leagues', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ leagues: [{ id: 'league_riv_1', name: 'Rivalry League', _count: { members: 12, entries: 12 } }] }),
      })
    })
    await page.route('**/api/bracket/leagues/league_riv_1/standings', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          standings: [
            { entryId: 'teamA', entryName: 'Alpha', ownerName: 'Alpha', points: 901, picksCount: 100, rank: 1 },
            { entryId: 'teamB', entryName: 'Bravo', ownerName: 'Bravo', points: 855, picksCount: 98, rank: 2 },
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
    await page.route('**/api/bracket/leagues/league_riv_1/chat', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ messages: [] }) })
    })
    await page.route('**/api/leagues/league_riv_1/dynasty-backfill', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          dynastySeasons: [
            { season: 2024, platformLeagueId: 'p-2024', importedAt: '2026-03-20T00:00:00.000Z' },
            { season: 2025, platformLeagueId: 'p-2025', importedAt: '2026-03-20T00:00:00.000Z' },
          ],
        }),
      })
    })
    await page.route('**/api/leagues/league_riv_1/relationship-profile**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          leagueId: 'league_riv_1',
          season: null,
          strongestRivalries: [],
          tradeClusters: [],
          influenceLeaders: [],
          centralManagers: [],
          isolatedManagers: [],
          dynastyPowerTransitions: [],
          repeatedEliminationPatterns: [],
          generatedAt: '2026-03-20T12:00:00.000Z',
        }),
      })
    })

    await page.route('**/api/leagues/league_riv_1/rivalries**', async (route) => {
      const url = route.request().url()
      const method = route.request().method()
      if (url.includes('/rivalries/explain')) {
        rivalryExplainCalls.push(url)
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ narrative: 'This rivalry is driven by repeated close games and playoff pressure.' }),
        })
        return
      }
      if (url.includes('/timeline')) {
        rivalryTimelineCalls.push(url)
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            timeline: [
              {
                eventId: 'evt-1',
                eventType: 'close_game',
                season: 2025,
                matchupId: null,
                tradeId: null,
                description: 'One-point upset',
                createdAt: '2026-03-20T00:00:00.000Z',
              },
            ],
          }),
        })
        return
      }
      if (url.includes('/head-to-head')) {
        rivalryHeadToHeadCalls.push(url)
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            history: [
              {
                matchupId: 'm1',
                season: 2025,
                weekOrPeriod: 8,
                teamAId: 'teamA',
                teamAName: 'Alpha',
                teamBId: 'teamB',
                teamBName: 'Bravo',
                scoreA: 112.4,
                scoreB: 111.2,
                winnerTeamId: 'teamA',
              },
            ],
          }),
        })
        return
      }
      if (url.endsWith('/rivalries/riv-1')) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            id: 'riv-1',
            leagueId: 'league_riv_1',
            sport: 'NBA',
            sportLabel: 'NBA',
            managerAId: 'teamA',
            managerBId: 'teamB',
            rivalryScore: 78.2,
            rivalryTier: 'Blood Feud',
            tierBadgeColor: 'red',
            firstDetectedAt: '2026-03-20T00:00:00.000Z',
            updatedAt: '2026-03-20T00:00:00.000Z',
            eventCount: 4,
          }),
        })
        return
      }
      if (method === 'POST') {
        const body = route.request().postDataJSON() as Record<string, unknown>
        rivalryRunBodies.push(body)
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ processed: 2, created: 1, updated: 1, rivalryIds: ['riv-1'] }),
        })
        return
      }

      const parsed = new URL(url)
      rivalryListCalls.push({
        sport: parsed.searchParams.get('sport'),
        season: parsed.searchParams.get('season'),
        managerAId: parsed.searchParams.get('managerAId'),
        managerBId: parsed.searchParams.get('managerBId'),
      })
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          rivalries: [
            {
              id: 'riv-1',
              leagueId: 'league_riv_1',
              sport: 'NBA',
              sportLabel: 'NBA',
              managerAId: 'teamA',
              managerBId: 'teamB',
              rivalryScore: 78.2,
              rivalryTier: 'Blood Feud',
              tierBadgeColor: 'red',
              firstDetectedAt: '2026-03-20T00:00:00.000Z',
              updatedAt: '2026-03-20T00:00:00.000Z',
              eventCount: 4,
            },
          ],
        }),
      })
    })

    /*
     * This spec STARTS on the ungated /leagues/<id> surface, but the "Details" link it
     * clicks is built as /app/league/<id>/rivalries/<id> (RivalryEngineList.tsx), which
     * IS session-gated. Anonymously the click lands on
     * /login?callbackUrl=%2Fapp%2Fleague%2F… and the waitForURL for **\/rivalries\/riv-1
     * never matches, so the whole test times out at the navigation rather than reporting
     * a redirect. The gate is inert locally (no NEXTAUTH_SECRET) and live in CI.
     */
    await signInAs(page, { id: 'e2e-rivalry-user' })

    await page.goto('/leagues/league_riv_1?tab=Intelligence')
    await expect(page.getByRole('heading', { name: 'League Intelligence Graph' }).first()).toBeVisible()
    await page.getByRole('button', { name: 'rivalries', exact: true }).click()

    await expect(page.getByRole('button', { name: 'Run rivalry engine' })).toBeVisible()
    await page.getByLabel('Rivalry manager selector A').selectOption('teamA')
    await page.getByLabel('Rivalry manager selector B').selectOption('teamB')
    await page.getByRole('button', { name: 'Refresh' }).last().click()
    await page.getByRole('button', { name: 'Run rivalry engine' }).click()
    await page.getByRole('button', { name: 'Explain', exact: true }).click()
    await expect(page.getByText(/repeated close games and playoff pressure/i)).toBeVisible()
    await page.getByRole('button', { name: 'Timeline', exact: true }).click()
    await expect(page.getByText(/One-point upset/i)).toBeVisible()

    await page.getByRole('link', { name: 'Details' }).click()
    await page.waitForURL('**/rivalries/riv-1**')
    await expect(page.getByRole('heading', { name: 'Rivalry Detail' })).toBeVisible()
    await page.getByRole('button', { name: 'Head-to-head History' }).click()
    await expect(page.getByText(/Alpha 112.4 - Bravo 111.2/i)).toBeVisible()
    await page.getByLabel('Rivalry season filter').selectOption('2025')
    await page.getByRole('button', { name: 'Rivalry Timeline' }).click()
    await expect(page.getByText(/One-point upset/i)).toBeVisible()
    await page.getByRole('button', { name: 'Explain this rivalry' }).click()
    await expect(page.getByText(/repeated close games and playoff pressure/i)).toBeVisible()
    await expect(page.getByRole('link', { name: 'Back to Intelligence' })).toBeVisible()

    expect(rivalryListCalls.length).toBeGreaterThan(0)
    expect(rivalryListCalls.some((c) => c.managerAId === 'teamA' && c.managerBId === 'teamB')).toBe(true)
    expect(rivalryRunBodies.length).toBeGreaterThan(0)
    expect(rivalryExplainCalls.length).toBeGreaterThan(0)
    expect(rivalryTimelineCalls.length).toBeGreaterThan(0)
    expect(rivalryHeadToHeadCalls.length).toBeGreaterThan(0)
  })
})

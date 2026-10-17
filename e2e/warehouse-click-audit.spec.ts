import { expect, test } from '@playwright/test'
import { signInAs } from './helpers/session-cookie'

test.describe.configure({ timeout: 180_000 })

test.describe('@warehouse full click audit', () => {
  test('audits warehouse filters, drill-downs, toggles, export, ai insight, and navigation', async ({ page }) => {
    const warehouseRequests: Array<{ view: string; sport: string; season: string | null; fromWeek: string | null; toWeek: string | null; teamId: string | null; playerId: string | null }> = []

    await page.route('**/api/bracket/**', async (route) => {
      const url = route.request().url()
      if (url.includes('/standings')) {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ standings: [] }) })
        return
      }
      if (url.includes('/chat')) {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ messages: [] }) })
        return
      }
      if (url.includes('/my-leagues')) {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ leagues: [] }) })
        return
      }
      if (url.includes('/entries')) {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ entries: [] }) })
        return
      }
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({}) })
    })

    await page.route('**/api/league/roster?**', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ roster: null }) })
    })

    await page.route('**/api/warehouse/league-history?**', async (route) => {
      const url = new URL(route.request().url())
      const view = url.searchParams.get('view') ?? 'summary'
      const sport = url.searchParams.get('sport') ?? 'NFL'
      const season = url.searchParams.get('season')
      const fromWeek = url.searchParams.get('fromWeek')
      const toWeek = url.searchParams.get('toWeek')
      const teamId = url.searchParams.get('teamId')
      const playerId = url.searchParams.get('playerId')
      warehouseRequests.push({ view, sport, season, fromWeek, toWeek, teamId, playerId })

      const summary = {
        leagueId: 'league_warehouse_1',
        sport,
        season: season ? Number(season) : 2026,
        matchupCount: 12,
        standingCount: 12,
        rosterSnapshotCount: 8,
        draftFactCount: 24,
        transactionCount: 30,
        playerGameFactCount: 200,
        teamGameFactCount: 60,
      }

      if (view === 'matchups') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            leagueId: summary.leagueId,
            view,
            summary,
            data: {
              matchups: [
                { matchupId: 'm1', weekOrPeriod: 1, teamA: 'teamA', teamB: 'teamB', scoreA: 124.2, scoreB: 117.4, winnerTeamId: 'teamA' },
              ],
            },
          }),
        })
        return
      }

      if (view === 'standings') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            leagueId: summary.leagueId,
            view,
            summary,
            data: {
              standings: [
                { standingId: 's1', rank: 1, teamId: 'teamA', wins: 10, losses: 2, ties: 0, pointsFor: 1520.5, pointsAgainst: 1312.2 },
              ],
            },
          }),
        })
        return
      }

      if (view === 'rosters') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            leagueId: summary.leagueId,
            view,
            summary,
            data: {
              snapshots: [
                { snapshotId: 'rs1', weekOrPeriod: 1, teamId: teamId ?? 'teamA', rosterPlayers: [1, 2, 3], lineupPlayers: [1, 2], benchPlayers: [3] },
              ],
            },
          }),
        })
        return
      }

      if (view === 'draft') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            leagueId: summary.leagueId,
            view,
            summary,
            data: {
              draft: [
                { draftId: 'd1', round: 1, pickNumber: 1, playerId: 'player1', managerId: 'manager1' },
              ],
            },
          }),
        })
        return
      }

      if (view === 'transactions') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            leagueId: summary.leagueId,
            view,
            summary,
            data: {
              transactions: [
                { transactionId: 't1', type: 'waiver_add', playerId: 'player1', managerId: 'manager1', createdAt: '2026-03-20T00:00:00.000Z' },
              ],
            },
          }),
        })
        return
      }

      if (view === 'player') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            leagueId: summary.leagueId,
            view,
            summary,
            data: {
              playerFacts: [
                { factId: 'pf1', weekOrRound: 1, fantasyPoints: 22.4, gameId: 'g1' },
              ],
              playerId: playerId ?? 'player1',
            },
          }),
        })
        return
      }

      if (view === 'team') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            leagueId: summary.leagueId,
            view,
            summary,
            data: {
              teamId: teamId ?? 'teamA',
              teamMatchups: [
                { matchupId: 'tm1', weekOrPeriod: 1, opponentTeamId: 'teamB', teamScore: 124.2, opponentScore: 117.4, result: 'W' },
              ],
            },
          }),
        })
        return
      }

      if (view === 'ai') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            leagueId: summary.leagueId,
            view,
            summary,
            data: {
              summary: {
                matchupCount: 12,
                standingCount: 12,
              },
              standings: [{ rank: 1, teamId: 'teamA' }],
              draftPicksCount: 24,
              transactionCount: 30,
            },
          }),
        })
        return
      }

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          leagueId: summary.leagueId,
          view: 'summary',
          summary,
          data: { summary },
        }),
      })
    })

    // /leagues/<id> shows a sign-in wall to a settled-unauthenticated session since
    // 1f5105f6 (every fetch on that page is session-gated). The mocked league APIs
    // still answer; the visitor just has to be signed in to reach the tab.
    await signInAs(page, { id: 'e2e-warehouse-user' })
    await page.goto('/leagues/league_warehouse_1?tab=Previous%20Leagues')
    await expect(page.getByRole('heading', { name: 'Previous Leagues' })).toBeVisible({ timeout: 45_000 })
    await expect(page.getByLabel('Warehouse view')).toHaveValue('summary')

    await page.getByLabel('Season filter').fill('2026')
    await page.getByLabel('From week').fill('1')
    await page.getByLabel('To week').fill('8')
    await page.getByLabel('Warehouse sport filter').selectOption('SOCCER')
    await page.getByRole('button', { name: 'Apply warehouse filters' }).click()

    await page.getByLabel('Warehouse view').selectOption('matchups')
    await page.getByRole('button', { name: 'Apply warehouse filters' }).click()
    await expect(page.getByRole('cell', { name: 'teamA' }).first()).toBeVisible()
    await page.getByRole('button', { name: /View matchup details for week 1/i }).click()
    await expect(page.getByRole('dialog', { name: 'Matchup details' })).toBeVisible()
    await page.getByRole('button', { name: 'Close matchup details' }).click()
    await expect(page.getByRole('dialog', { name: 'Matchup details' })).toHaveCount(0)

    await page.getByLabel('Warehouse view').selectOption('standings')
    await page.getByRole('button', { name: 'Apply warehouse filters' }).click()
    await expect(page.getByRole('cell', { name: 'teamA' }).first()).toBeVisible()

    await page.getByLabel('Warehouse view').selectOption('rosters')
    await page.getByLabel('Team ID filter').fill('teamA')
    await page.getByRole('button', { name: 'Apply warehouse filters' }).click()
    await expect(page.getByText(/Roster: 3/i)).toBeVisible()

    await page.getByLabel('Warehouse view').selectOption('player')
    await page.getByLabel('Player ID filter').fill('player1')
    await page.getByRole('button', { name: 'Apply warehouse filters' }).click()
    await expect(page.getByRole('cell', { name: '22.4' })).toBeVisible()

    await page.getByLabel('Warehouse view').selectOption('team')
    await page.getByLabel('Team ID filter').fill('teamA')
    await page.getByRole('button', { name: 'Apply warehouse filters' }).click()
    await expect(page.getByRole('cell', { name: 'teamB' }).first()).toBeVisible()

    await page.getByRole('button', { name: 'Hide warehouse charts' }).click()
    await expect(page.getByRole('button', { name: 'Show warehouse charts' })).toBeVisible()

    await page.getByRole('button', { name: 'Launch AI warehouse insight' }).click()
    await expect(page.getByText(/Warehouse AI insight context/i)).toBeVisible()

    const downloadPromise = page.waitForEvent('download')
    await page.getByRole('button', { name: 'Export warehouse data' }).click()
    const download = await downloadPromise
    expect(download.suggestedFilename()).toContain('warehouse-league_warehouse_1')

    await page.getByRole('button', { name: 'Refresh warehouse data' }).click()
    await page.getByRole('button', { name: 'Back to Overview tab' }).click()
    await expect(page.getByRole('heading', { name: 'League Snapshot' })).toBeVisible()

    expect(warehouseRequests.some((r) => r.view === 'matchups' && r.sport === 'SOCCER' && r.season === '2026')).toBe(true)
    expect(warehouseRequests.some((r) => r.view === 'player' && r.playerId === 'player1')).toBe(true)
    expect(warehouseRequests.some((r) => r.view === 'team' && r.teamId === 'teamA')).toBe(true)
    expect(warehouseRequests.some((r) => r.view === 'ai')).toBe(true)
  })
})


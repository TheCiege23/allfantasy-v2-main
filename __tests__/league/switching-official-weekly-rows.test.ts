/**
 * An official switching league's core Matchup screen, league home card and live strip read AllFantasy's
 * schedule back in the `WeeklyMatchup` row shape (lib/league/switching/officialWeeklyRows.ts), keyed by
 * each team's platform id, so nothing downstream changes and the shared platform rows are never written.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ seasonFindFirst: vi.fn(), matchupFindMany: vi.fn(), rosterFindMany: vi.fn() }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    redraftSeason: { findFirst: h.seasonFindFirst },
    redraftMatchup: { findMany: h.matchupFindMany },
    roster: { findMany: h.rosterFindMany },
  },
}))

import { loadOfficialWeeklyRows } from '@/lib/league/switching/officialWeeklyRows'

const stamp = { at: '2026-11-27T00:00:00.000Z', byUserId: 'commish' }
const official = { id: 'L1', settings: { switching: { official: stamp, teams: {} } } }
const notOfficial = { id: 'L1', settings: { switching: { official: null, teams: {} } } }

beforeEach(() => {
  vi.resetAllMocks()
  h.seasonFindFirst.mockResolvedValue({ id: 's1' })
  h.rosterFindMany.mockResolvedValue([
    { redraftRosterId: 'rr-1', playerData: { source_team_id: '1' } },
    { redraftRosterId: 'rr-2', playerData: { source_team_id: '2' } },
    { redraftRosterId: 'rr-3', playerData: { source_team_id: '3' } },
    { redraftRosterId: 'rr-4', playerData: { source_team_id: '4' } },
  ])
  h.matchupFindMany.mockResolvedValue([
    { week: 11, homeRosterId: 'rr-1', awayRosterId: 'rr-2', homeScore: 120.5, awayScore: 98, status: 'final' },
    { week: 11, homeRosterId: 'rr-3', awayRosterId: 'rr-4', homeScore: 90, awayScore: 101, status: 'final' },
    { week: 12, homeRosterId: 'rr-1', awayRosterId: 'rr-3', homeScore: 40, awayScore: 12, status: 'in_progress' },
  ])
})

describe('loadOfficialWeeklyRows', () => {
  it('reads nothing for a league that is not official, so the caller reads the platform rows as before', async () => {
    expect(await loadOfficialWeeklyRows(notOfficial, 2026)).toBeNull()
    expect(h.seasonFindFirst).not.toHaveBeenCalled()
  })

  it("gives one row per team per game, keyed by the team's platform id, with a win marked only once final", async () => {
    const rows = await loadOfficialWeeklyRows(official, 2026)
    expect(rows).toEqual([
      { seasonYear: 2026, week: 11, rosterId: '1', matchupId: 1, game: 1, pointsFor: 120.5, pointsAgainst: 98, win: 1 },
      { seasonYear: 2026, week: 11, rosterId: '2', matchupId: 1, game: 1, pointsFor: 98, pointsAgainst: 120.5, win: 0 },
      { seasonYear: 2026, week: 11, rosterId: '3', matchupId: 2, game: 1, pointsFor: 90, pointsAgainst: 101, win: 0 },
      { seasonYear: 2026, week: 11, rosterId: '4', matchupId: 2, game: 1, pointsFor: 101, pointsAgainst: 90, win: 1 },
      // A week in progress: AllFantasy's live score, no result yet. Matchup ids restart each week.
      { seasonYear: 2026, week: 12, rosterId: '1', matchupId: 1, game: 1, pointsFor: 40, pointsAgainst: 12, win: 0 },
      { seasonYear: 2026, week: 12, rosterId: '3', matchupId: 1, game: 1, pointsFor: 12, pointsAgainst: 40, win: 0 },
    ])
    expect(h.matchupFindMany.mock.calls[0][0].where).toEqual({ seasonId: 's1', isMedianMatchup: false })
  })

  it("narrows to one week, and to the two teams a head-to-head asks about", async () => {
    await loadOfficialWeeklyRows(official, 2026, { week: 12 })
    expect(h.matchupFindMany.mock.calls[0][0].where).toEqual({ seasonId: 's1', isMedianMatchup: false, week: 12 })

    const rows = await loadOfficialWeeklyRows(official, 2026, { rosterIds: ['1', '3'] })
    expect(rows?.map((r) => `${r.week}:${r.rosterId}`)).toEqual(['11:1', '11:3', '12:1', '12:3'])
  })

  it('is empty, not the platform rows, when the official league has no AllFantasy season for that year', async () => {
    h.seasonFindFirst.mockResolvedValue(null)
    expect(await loadOfficialWeeklyRows(official, 2025)).toEqual([])
  })
})

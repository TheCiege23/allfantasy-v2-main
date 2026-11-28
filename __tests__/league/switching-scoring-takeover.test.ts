/**
 * Rule 3 of a switching league: AllFantasy scoring is official once the league is, and it takes over at
 * "Make it official" (decided 2026-11-27). The platform's regular-season schedule is copied into
 * AllFantasy's, with the weeks already played carried over as final; waivers settle only for teams that
 * switched; AllFantasy's engines run the league from then on.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  leagueFindUnique: vi.fn(),
  seasonFindFirst: vi.fn(),
  matchupCount: vi.fn(),
  weeklyFindMany: vi.fn(),
  rosterFindMany: vi.fn(),
  createMany: vi.fn(),
  seasonUpdate: vi.fn(),
}))

vi.mock('@/lib/prisma', () => {
  const tx = {
    redraftMatchup: { count: h.matchupCount, createMany: h.createMany },
    redraftSeason: { update: h.seasonUpdate },
  }
  return {
    prisma: {
      league: { findUnique: h.leagueFindUnique },
      redraftSeason: { findFirst: h.seasonFindFirst },
      redraftMatchup: { count: h.matchupCount },
      weeklyMatchup: { findMany: h.weeklyFindMany },
      roster: { findMany: h.rosterFindMany },
      $transaction: (fn: (t: typeof tx) => unknown) => fn(tx),
    },
  }
})

import { copyPlatformScheduleToAllFantasy, pairPlatformWeeks } from '@/lib/league/switching/takeOverSchedule'
import { claimsRunOnAllFantasy, runsOnAllFantasy } from '@/lib/league/switching/switchingLeague'

const stamp = { at: '2026-11-27T00:00:00.000Z', byUserId: 'commish' }
const official = { switching: { official: stamp, teams: { 'team-1': stamp } } }
const notOfficial = { switching: { official: null, teams: { 'team-1': stamp } } }

const row = (week: number, rosterId: string, matchupId: number | null, pointsFor: number, game = 1) => ({ week, rosterId, matchupId, game, pointsFor })

describe('pairPlatformWeeks', () => {
  it('pairs two rows on one matchup id into a game and skips a bye', () => {
    const out = pairPlatformWeeks([row(1, '2', 7, 90), row(1, '1', 7, 100), row(1, '3', null, 80), row(1, '4', 9, 70)])
    expect(out).toEqual({ ok: true, pairs: [{ week: 1, home: { rosterId: '1', points: 100 }, away: { rosterId: '2', points: 90 } }] })
  })

  it('refuses a league that plays several games a week', () => {
    expect(pairPlatformWeeks([row(1, '1', 1, 10, 2)]).ok).toBe(false)
  })

  it('refuses a game with three teams on it', () => {
    expect(pairPlatformWeeks([row(1, '1', 1, 1), row(1, '2', 1, 2), row(1, '3', 1, 3)]).ok).toBe(false)
  })
})

describe('copyPlatformScheduleToAllFantasy', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    h.leagueFindUnique.mockResolvedValue({ platformLeagueId: 'sleeper-1', season: 2026 })
    h.seasonFindFirst.mockResolvedValue({ id: 'season-1', season: 2026, playoffStartWeek: 15 })
    h.matchupCount.mockResolvedValue(0)
    h.rosterFindMany.mockResolvedValue([
      { redraftRosterId: 'rr-1', playerData: { source_team_id: '1' } },
      { redraftRosterId: 'rr-2', playerData: { source_team_id: '2' } },
    ])
    h.weeklyFindMany.mockResolvedValue([row(11, '1', 3, 120.5), row(11, '2', 3, 98), row(12, '1', 4, 0), row(12, '2', 4, 0)])
  })

  it('carries played weeks over as final at the platform score and schedules the rest', async () => {
    const out = await copyPlatformScheduleToAllFantasy('L1', { currentWeek: 12 })

    expect(out).toEqual({ ok: true, alreadyTaken: false, matchupsCreated: 2, weeksFinal: 1 })
    expect(h.createMany.mock.calls[0][0].data).toEqual([
      { seasonId: 'season-1', leagueId: 'L1', week: 11, homeRosterId: 'rr-1', awayRosterId: 'rr-2', homeScore: 120.5, awayScore: 98, status: 'final' },
      { seasonId: 'season-1', leagueId: 'L1', week: 12, homeRosterId: 'rr-1', awayRosterId: 'rr-2', homeScore: 0, awayScore: 0, status: 'scheduled' },
    ])
    expect(h.seasonUpdate).toHaveBeenCalledWith({ where: { id: 'season-1' }, data: { currentWeek: 12 } })
    // Regular season only: AllFantasy builds the playoff bracket itself.
    expect(h.weeklyFindMany.mock.calls[0][0].where.week).toEqual({ lt: 15 })
  })

  it('leaves a season that already has an AllFantasy schedule alone', async () => {
    h.matchupCount.mockResolvedValue(30)
    expect(await copyPlatformScheduleToAllFantasy('L1', { currentWeek: 12 })).toEqual({ ok: true, alreadyTaken: true, matchupsCreated: 0, weeksFinal: 0 })
    expect(h.createMany).not.toHaveBeenCalled()
  })

  it('refuses, writing nothing, when a team on the schedule is not linked', async () => {
    h.rosterFindMany.mockResolvedValue([{ redraftRosterId: 'rr-1', playerData: { source_team_id: '1' } }])
    const out = await copyPlatformScheduleToAllFantasy('L1', { currentWeek: 12 })
    expect(out.ok).toBe(false)
    expect(h.createMany).not.toHaveBeenCalled()
  })

  it('refuses when the platform schedule has not been copied in yet', async () => {
    h.weeklyFindMany.mockResolvedValue([])
    expect((await copyPlatformScheduleToAllFantasy('L1', { currentWeek: 12 })).ok).toBe(false)
  })
})

describe('who AllFantasy runs', () => {
  it('runs native leagues and official imported leagues only', () => {
    expect(runsOnAllFantasy({ platform: 'allfantasy', settings: null })).toBe(true)
    expect(runsOnAllFantasy({ platform: 'sleeper', settings: official })).toBe(true)
    expect(runsOnAllFantasy({ platform: 'sleeper', settings: notOfficial })).toBe(false)
    expect(runsOnAllFantasy({ platform: 'sleeper', settings: null })).toBe(false)
  })

  it('settles waiver claims only for switched teams in an official league', () => {
    const teams = [{ id: 'team-1', externalId: '1' }, { id: 'team-2', externalId: '2' }]
    const claims = [
      { id: 'c1', roster: { playerData: { source_team_id: '1' } } },
      { id: 'c2', roster: { playerData: { source_team_id: '2' } } },
    ]
    expect(claimsRunOnAllFantasy(official, teams, claims).map((c) => c.id)).toEqual(['c1'])
    // Control: not official, every claim runs as before.
    expect(claimsRunOnAllFantasy(notOfficial, teams, claims).map((c) => c.id)).toEqual(['c1', 'c2'])
  })
})

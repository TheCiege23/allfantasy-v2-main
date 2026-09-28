/**
 * The league-engine scorers must refuse a week they cannot score, never store it as 0.
 *
 * `computeRosterScoreForWeek` and `selectBestBallLineupForRoster` read `player_game_stats` by
 * `weekOrRound`. On the daily sports that column is 0 on every row, so a week-N query matched
 * nothing and the roster was written as 0 points; a week-0 query would have matched the whole
 * season. `scoreLeagueWeek` then folded those zeros into pointsFor/currentRank and could lock them.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

type StatRow = { playerId: string; normalizedStatMap: Record<string, number> | null; fantasyPoints: number | null }

const statRows = vi.fn<(ids: string[]) => StatRow[]>()
const playerGameStatFindMany = vi.fn(async (args: { where: { playerId: { in: string[] } } }) =>
  statRows(args.where.playerId.in).filter((r) => args.where.playerId.in.includes(r.playerId)),
)
const leagueFindUnique = vi.fn()
const teamPerformanceUpsert = vi.fn(async () => ({}))
const leagueTeamUpdate = vi.fn(async () => ({}))
const snapshotCreate = vi.fn(async () => ({}))
const leagueUpdate = vi.fn(async () => ({}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    playerGameStat: { findMany: (args: never) => playerGameStatFindMany(args) },
    sportsPlayer: { findMany: vi.fn(async () => []) },
    league: { findUnique: (...a: unknown[]) => leagueFindUnique(...a), update: (...a: unknown[]) => leagueUpdate(...(a as [])) },
    teamPerformance: {
      upsert: (...a: unknown[]) => teamPerformanceUpsert(...(a as [])),
      findMany: vi.fn(async () => []),
    },
    leagueTeam: { update: (...a: unknown[]) => leagueTeamUpdate(...(a as [])) },
    scoringSettingsSnapshot: { create: (...a: unknown[]) => snapshotCreate(...(a as [])) },
  },
}))
vi.mock('@/lib/multi-sport/MultiSportScoringResolver', () => ({
  resolveScoringRulesForLeague: vi.fn(async () => []),
}))
vi.mock('@/lib/multi-sport/MultiSportRosterService', () => ({
  getRosterTemplateForLeague: vi.fn(async () => ({ slots: [{ slotName: 'FLEX', starterCount: 2, allowedPositions: ['UTIL'] }] })),
}))

import {
  computeRosterScoreForWeek,
  weekKeyedStatsUnavailableReason,
} from '@/lib/multi-sport/MultiSportMatchupScoringService'
import { selectBestBallLineupForRoster } from '@/lib/scoring/best-ball-engine'
import { scoreLeagueWeek } from '@/lib/scoring/scoring-engine'

const row = (playerId: string, fantasyPoints: number): StatRow => ({ playerId, normalizedStatMap: null, fantasyPoints })

beforeEach(() => {
  vi.clearAllMocks()
  statRows.mockReturnValue([])
})

describe('weekKeyedStatsUnavailableReason', () => {
  it('lets through only the week-keyed sports, and only real weeks', () => {
    expect(weekKeyedStatsUnavailableReason('NFL', 3)).toBeNull()
    expect(weekKeyedStatsUnavailableReason('nfl', 3)).toBeNull()
    expect(weekKeyedStatsUnavailableReason('NCAAF', 1)).toBeNull()
    for (const sport of ['NHL', 'NBA', 'MLB', 'NCAAB', 'SOCCER', '']) {
      expect(weekKeyedStatsUnavailableReason(sport, 3)).toMatch(/not keyed by week/)
    }
    expect(weekKeyedStatsUnavailableReason('NFL', 0)).toMatch(/not a scoring week/)
    expect(weekKeyedStatsUnavailableReason('NFL', Number.NaN)).toMatch(/not a scoring week/)
  })
})

describe('computeRosterScoreForWeek', () => {
  const base = { leagueId: 'L', leagueSport: 'NFL' as never, season: 2026, weekOrRound: 3, rosterPlayerIds: ['p1', 'p2'] }

  it('refuses a daily sport without querying — its rows carry no week', async () => {
    const r = await computeRosterScoreForWeek({ ...base, leagueSport: 'NHL' as never })
    expect(r.status).toBe('UNAVAILABLE')
    expect(r.unavailableReason).toMatch(/NHL game stats are not keyed by week/)
    expect(playerGameStatFindMany).not.toHaveBeenCalled()
  })

  it('refuses week 0, which would match a daily sport’s whole season', async () => {
    const r = await computeRosterScoreForWeek({ ...base, weekOrRound: 0 })
    expect(r.status).toBe('UNAVAILABLE')
    expect(playerGameStatFindMany).not.toHaveBeenCalled()
  })

  it('is UNAVAILABLE, not 0, when no scored player has a stat row', async () => {
    const r = await computeRosterScoreForWeek(base)
    expect(r.status).toBe('UNAVAILABLE')
    expect(r.missingPlayerIds).toEqual(['p1', 'p2'])
  })

  it('is PARTIAL when some players have rows, and scores those', async () => {
    statRows.mockReturnValue([row('p1', 12.5)])
    const r = await computeRosterScoreForWeek(base)
    expect(r.status).toBe('PARTIAL')
    expect(r.totalPoints).toBe(12.5)
    expect(r.missingPlayerIds).toEqual(['p2'])
  })

  it('is AVAILABLE when every scored player has a row', async () => {
    statRows.mockReturnValue([row('p1', 10), row('p2', 5.25)])
    const r = await computeRosterScoreForWeek(base)
    expect(r.status).toBe('AVAILABLE')
    expect(r.totalPoints).toBe(15.25)
    expect(r.unavailableReason).toBeNull()
  })
})

describe('selectBestBallLineupForRoster', () => {
  it('refuses a daily sport without querying', async () => {
    const r = await selectBestBallLineupForRoster({
      leagueId: 'L', leagueSport: 'NBA' as never, season: 2026, weekOrRound: 3, rosterPlayerIds: ['p1'],
    })
    expect(r.status).toBe('UNAVAILABLE')
    expect(r.starterIds).toEqual([])
    expect(r.notes[0]).toMatch(/NBA game stats are not keyed by week/)
    expect(playerGameStatFindMany).not.toHaveBeenCalled()
  })
})

describe('scoreLeagueWeek', () => {
  const league = (sport: string) => ({
    id: 'L',
    sport,
    settings: {},
    leagueVariant: null,
    rosters: [
      { id: 'r1', platformUserId: 'u1', playerData: { players: ['p1'], starters: ['p1'] } },
      { id: 'r2', platformUserId: 'u2', playerData: { players: ['p2'], starters: ['p2'] } },
    ],
    teams: [
      { id: 't1', externalId: 'u1' },
      { id: 't2', externalId: 'u2' },
    ],
  })

  function expectNothingWritten() {
    expect(teamPerformanceUpsert).not.toHaveBeenCalled()
    expect(leagueTeamUpdate).not.toHaveBeenCalled()
    expect(snapshotCreate).not.toHaveBeenCalled()
    expect(leagueUpdate).not.toHaveBeenCalled()
  }

  it('writes NOTHING for the week when one team cannot be scored — not a 0 for that team', async () => {
    leagueFindUnique.mockResolvedValue(league('NFL'))
    statRows.mockReturnValue([row('p1', 20)])
    const r = await scoreLeagueWeek({ leagueId: 'L', season: 2026, weekOrRound: 3, lockScores: true })
    expect(r.status).toBe('unavailable')
    expect(r.locked).toBe(false)
    expect(r.updatedTeamCount).toBe(0)
    expect(r.unavailable).toEqual([
      { rosterId: 'r2', teamId: 't2', reason: expect.stringMatching(/No player game statistics/) },
    ])
    expectNothingWritten()
  })

  it('never scores a daily-sport league, and never queries its stats', async () => {
    leagueFindUnique.mockResolvedValue(league('NHL'))
    const r = await scoreLeagueWeek({ leagueId: 'L', season: 2026, weekOrRound: 1 })
    expect(r.status).toBe('unavailable')
    expect(r.unavailable.map((u) => u.teamId)).toEqual(['t1', 't2'])
    expect(playerGameStatFindMany).not.toHaveBeenCalled()
    expectNothingWritten()
  })

  it('still scores and writes a week every team can be scored for', async () => {
    leagueFindUnique.mockResolvedValue(league('NFL'))
    statRows.mockReturnValue([row('p1', 20), row('p2', 7)])
    const r = await scoreLeagueWeek({ leagueId: 'L', season: 2026, weekOrRound: 3 })
    expect(r.status).toBe('scored')
    expect(r.updatedTeamCount).toBe(2)
    expect(teamPerformanceUpsert).toHaveBeenCalledTimes(2)
    const points = teamPerformanceUpsert.mock.calls.map((c) => (c as unknown as [{ create: { teamId: string; points: number } }])[0].create)
    expect(points.map((p) => [p.teamId, p.points])).toEqual([['t1', 20], ['t2', 7]])
    expect(snapshotCreate).toHaveBeenCalledTimes(1)
  })
})

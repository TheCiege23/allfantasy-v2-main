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
const sportsPlayerFindMany = vi.fn(async (): Promise<unknown[]> => [])
const teamPerformanceUpsert = vi.fn(async () => ({}))
const leagueTeamUpdate = vi.fn(async () => ({}))
const snapshotCreate = vi.fn(async () => ({}))
const leagueUpdate = vi.fn(async () => ({}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    playerGameStat: { findMany: (args: never) => playerGameStatFindMany(args) },
    sportsPlayer: { findMany: (...a: unknown[]) => sportsPlayerFindMany(...(a as [])) },
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
import { resolveScoringRulesForLeague } from '@/lib/multi-sport/MultiSportScoringResolver'

const row = (playerId: string, fantasyPoints: number): StatRow => ({ playerId, normalizedStatMap: null, fantasyPoints })

beforeEach(() => {
  vi.clearAllMocks()
  statRows.mockReturnValue([])
  sportsPlayerFindMany.mockResolvedValue([])
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
      leagueId: 'L', leagueSport: 'NBA' as never, season: 2026, weekOrRound: 3, rosterPlayerIds: ['p1'], platform: 'sleeper',
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

  describe('a best ball league (audit 2026-11-06, finding #17)', () => {
    const bestBallLeague = (sections: Record<string, number>) => ({
      ...league('NFL'),
      platform: 'sleeper',
      settings: { best_ball: true, roster: { config: { sections: [{ key: 'primary', slots: sections }] } } },
      rosters: [{ id: 'r1', platformUserId: 'u1', playerData: { players: ['p1', 'p2', 'p3'] } }],
      teams: [{ id: 't1', externalId: 'u1' }],
    })
    const sleeperRow = (id: string, position: string) => ({ externalId: id, sleeperId: id, name: id, position, team: 'KC', source: 'sleeper', updatedAt: new Date(0) })

    it("scores the optimal lineup over the LEAGUE'S slots, never the whole roster", async () => {
      leagueFindUnique.mockResolvedValue(bestBallLeague({ QB: 1, RB: 1, BN: 4 }))
      statRows.mockReturnValue([row('p1', 20), row('p2', 7), row('p3', 5)])
      sportsPlayerFindMany.mockResolvedValue([sleeperRow('p1', 'QB'), sleeperRow('p2', 'RB'), sleeperRow('p3', 'RB')])
      const r = await scoreLeagueWeek({ leagueId: 'L', season: 2026, weekOrRound: 3 })
      expect(r.status).toBe('scored')
      const write = (teamPerformanceUpsert.mock.calls[0] as unknown as [{ create: { points: number; data: { starterIds: string[] } } }])[0].create
      // QB 20 + the better RB 7 = 27. The whole roster would be 32.
      expect(write.points).toBe(27)
      expect([...write.data.starterIds].sort()).toEqual(['p1', 'p2'])
    })

    /*
     * The lineup is chosen on the points the week is SCORED with. Selection used to read each stat row's
     * own `fantasyPoints` while the score recomputed the row from `normalizedStatMap` under the league's
     * rules — two pipelines that can disagree on who is better. Here they do: p1's row says 30 (a
     * PPR-style number from his 10 catches) and p2's says 12, but this league pays 0.1 per rushing yard
     * and nothing per catch, so under the league's rules p1 is worth 1.0 and p2 20.0.
     */
    it('seats the player who is better under the LEAGUE rules, and the score is that lineup', async () => {
      leagueFindUnique.mockResolvedValue(bestBallLeague({ RB: 1, BN: 4 }))
      statRows.mockReturnValue([
        { playerId: 'p1', normalizedStatMap: { receptions: 10, rushing_yards: 10 }, fantasyPoints: 30 },
        { playerId: 'p2', normalizedStatMap: { rushing_yards: 200 }, fantasyPoints: 12 },
      ])
      sportsPlayerFindMany.mockResolvedValue([sleeperRow('p1', 'RB'), sleeperRow('p2', 'RB')])
      const rules = vi.mocked(resolveScoringRulesForLeague)
      rules.mockImplementation(async () => [{ statKey: 'rushing_yards', pointsValue: 0.1, multiplier: 1, enabled: true }])
      try {
        const r = await scoreLeagueWeek({ leagueId: 'L', season: 2026, weekOrRound: 3 })
        expect(r.status).toBe('scored')
        const write = (teamPerformanceUpsert.mock.calls[0] as unknown as [{ create: { points: number; data: { starterIds: string[]; byPlayerId: Record<string, number> } } }])[0].create
        // p1 seated would score 1.0 — the old answer. p2 is the better RB by the points that count.
        expect(write.data.starterIds).toEqual(['p2'])
        expect(write.points).toBe(20)
        expect(write.data.byPlayerId).toEqual({ p2: 20 })
      } finally {
        rules.mockImplementation(async () => [])
      }
    })

    it('a team with no best ball lineup is UNAVAILABLE and nothing is written — not the sum of its roster', async () => {
      leagueFindUnique.mockResolvedValue(bestBallLeague({ QB: 1, RB: 1, BN: 4 }))
      statRows.mockReturnValue([row('p1', 20), row('p2', 7), row('p3', 5)])
      // No player resolves to a position, so no seat can be filled and no lineup exists.
      sportsPlayerFindMany.mockResolvedValue([])
      const r = await scoreLeagueWeek({ leagueId: 'L', season: 2026, weekOrRound: 3 })
      expect(r.status).toBe('unavailable')
      expect(r.unavailable).toEqual([{ rosterId: 'r1', teamId: 't1', reason: expect.stringMatching(/^best_ball_/) }])
      expectNothingWritten()
    })
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

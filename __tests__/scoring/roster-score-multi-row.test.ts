/**
 * A player with more than one `player_game_stats` row in a week must be ONE number, and the roster
 * total must be the sum of those numbers.
 *
 * `computeRosterScoreForWeek` used to keep only the LAST row per player in `byPlayerId` while adding
 * EVERY row to `totalPoints`. Best ball seats on `byPlayerId`, so a two-row player was valued as one
 * game for selection and two for the total. Distinct games now SUM; a row ingested twice counts once.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

type StatRow = {
  playerId: string
  gameId?: string | null
  providerGameId?: string | null
  normalizedStatMap: Record<string, number> | null
  fantasyPoints: number | null
}

const statRows = vi.fn<() => StatRow[]>()
const playerGameStatFindMany = vi.fn(async (args: { where: { playerId: { in: string[] } } }) =>
  statRows().filter((r) => args.where.playerId.in.includes(r.playerId)),
)
const sportsPlayerFindMany = vi.fn(async (): Promise<unknown[]> => [])
const leagueFindUnique = vi.fn()
const teamPerformanceUpsert = vi.fn(async () => ({}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    playerGameStat: { findMany: (args: never) => playerGameStatFindMany(args) },
    sportsPlayer: { findMany: (...a: unknown[]) => sportsPlayerFindMany(...(a as [])) },
    league: { findUnique: (...a: unknown[]) => leagueFindUnique(...a), update: vi.fn(async () => ({})) },
    teamPerformance: { upsert: (...a: unknown[]) => teamPerformanceUpsert(...(a as [])), findMany: vi.fn(async () => []) },
    leagueTeam: { update: vi.fn(async () => ({})) },
    scoringSettingsSnapshot: { create: vi.fn(async () => ({})) },
  },
}))
vi.mock('@/lib/multi-sport/MultiSportScoringResolver', () => ({
  // 1 point per yard, so a stat map's value is easy to read off.
  resolveScoringRulesForLeague: vi.fn(async () => [{ statKey: 'rushing_yards', pointsValue: 1, multiplier: 1, enabled: true }]),
}))

import { computeRosterScoreForWeek, statRowDedupeKey } from '@/lib/multi-sport/MultiSportMatchupScoringService'
import { selectBestBallLineupForRoster } from '@/lib/scoring/best-ball-engine'
import { scoreLeagueWeek } from '@/lib/scoring/scoring-engine'

const base = { leagueId: 'L', leagueSport: 'NFL' as never, season: 2026, weekOrRound: 3, rosterPlayerIds: ['p1', 'p2'] }
const line = (playerId: string, gameId: string, yards: number, providerGameId: string | null = null): StatRow => ({
  playerId,
  gameId,
  providerGameId,
  normalizedStatMap: { rushing_yards: yards },
  fantasyPoints: 0,
})
const sleeperRow = (id: string, position: string) => ({ externalId: id, sleeperId: id, name: id, position, team: 'KC', source: 'sleeper', updatedAt: new Date(0) })

beforeEach(() => {
  vi.clearAllMocks()
  statRows.mockReturnValue([])
  sportsPlayerFindMany.mockResolvedValue([])
})

describe('computeRosterScoreForWeek with several rows for one player', () => {
  it('SUMS two real games, and byPlayerId agrees with the total', async () => {
    statRows.mockReturnValue([line('p1', 'g1', 8), line('p1', 'g2', 9), line('p2', 'g3', 5)])
    const r = await computeRosterScoreForWeek(base)
    expect(r.byPlayerId).toEqual({ p1: 17, p2: 5 })
    expect(r.totalPoints).toBe(22)
    expect(Object.values(r.byPlayerId).reduce((a, b) => a + b, 0)).toBe(r.totalPoints)
    expect(r.usedPlayerIds).toEqual(['p1', 'p2'])
    expect(r.status).toBe('AVAILABLE')
  })

  it('counts a row ingested twice (same provider game, identical stats, two internal ids) ONCE', async () => {
    statRows.mockReturnValue([
      line('p1', 'nflverse:2026_03_KC_BUF', 8, '2026_03_KC_BUF'),
      { ...line('p1', 'sleeper:2026_03_KC_BUF', 0, '2026_03_KC_BUF'), normalizedStatMap: { rushing_yards: 8 } },
      line('p2', 'g3', 5),
    ])
    const r = await computeRosterScoreForWeek(base)
    expect(r.byPlayerId).toEqual({ p1: 8, p2: 5 })
    expect(r.totalPoints).toBe(13)
  })

  it('treats stat-map key order as irrelevant when matching a duplicate', async () => {
    statRows.mockReturnValue([
      { playerId: 'p1', gameId: 'a', providerGameId: 'G', normalizedStatMap: { rushing_yards: 8, receptions: 2 }, fantasyPoints: 0 },
      { playerId: 'p1', gameId: 'b', providerGameId: 'G', normalizedStatMap: { receptions: 2, rushing_yards: 8 }, fantasyPoints: 0 },
    ])
    const r = await computeRosterScoreForWeek({ ...base, rosterPlayerIds: ['p1'] })
    expect(r.byPlayerId).toEqual({ p1: 8 })
    expect(r.totalPoints).toBe(8)
  })

  it('keeps two DIFFERENT lines of one provider game (a two-way player) and sums them', async () => {
    statRows.mockReturnValue([line('p1', 'G:batting', 3, 'G'), line('p1', 'G:pitching', 4, 'G')])
    const r = await computeRosterScoreForWeek({ ...base, rosterPlayerIds: ['p1'] })
    expect(r.byPlayerId).toEqual({ p1: 7 })
    expect(r.totalPoints).toBe(7)
  })

  it('never merges two different players who share a game', async () => {
    statRows.mockReturnValue([line('p1', 'G', 6, 'G'), line('p2', 'G', 6, 'G')])
    const r = await computeRosterScoreForWeek(base)
    expect(r.byPlayerId).toEqual({ p1: 6, p2: 6 })
    expect(r.totalPoints).toBe(12)
  })
})

describe('statRowDedupeKey', () => {
  it('is null for a row with no game identity, so such a row is always counted', () => {
    expect(statRowDedupeKey({ playerId: 'p1', normalizedStatMap: { x: 1 } })).toBeNull()
  })
})

describe('best ball seats on the same per-player number the score counts', () => {
  it('a two-game player is valued at both games for selection, and the stored score is that lineup', async () => {
    // p1: two games of 8 = 16. p2: one game of 12. Valued on the last row only, p1 was worth 8 and
    // lost the RB seat to p2 — while the total would still have counted 16 for him.
    statRows.mockReturnValue([line('p1', 'g1', 8), line('p1', 'g2', 8), line('p2', 'g3', 12)])
    sportsPlayerFindMany.mockResolvedValue([sleeperRow('p1', 'RB'), sleeperRow('p2', 'RB')])
    const settings = { best_ball: true, roster: { config: { sections: [{ key: 'primary', slots: { RB: 1, BN: 4 } }] } } }

    const sel = await selectBestBallLineupForRoster({
      ...base, platform: 'sleeper', leagueSettings: settings,
    })
    expect(sel.starterIds).toEqual(['p1'])
    expect(sel.totalProjectedPoints).toBe(16)

    leagueFindUnique.mockResolvedValue({
      id: 'L', sport: 'NFL', platform: 'sleeper', settings, leagueVariant: null,
      rosters: [{ id: 'r1', platformUserId: 'u1', playerData: { players: ['p1', 'p2'] } }],
      teams: [{ id: 't1', externalId: 'u1' }],
    })
    const r = await scoreLeagueWeek({ leagueId: 'L', season: 2026, weekOrRound: 3 })
    expect(r.status).toBe('scored')
    const write = (teamPerformanceUpsert.mock.calls[0] as unknown as [{ create: { points: number; data: { starterIds: string[]; byPlayerId: Record<string, number> } } }])[0].create
    expect(write.data.starterIds).toEqual(['p1'])
    expect(write.points).toBe(16)
    expect(write.data.byPlayerId).toEqual({ p1: 16 })
  })
})

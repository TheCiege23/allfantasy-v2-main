import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Native leagues' per-player weekly points (lib/redraft/nativePlayerWeeklyScores.ts): the scoring
 * engine computed them on every rescore and threw them away, so Storyline Studio's player hooks had
 * nothing to read for a league we host. These pin the writer (idempotent, starters vs bench, keyed on
 * OUR League.id and never the synthetic platform id) and that `updateMatchupScores` feeds it.
 */

const db = vi.hoisted(() => ({
  league: { findFirst: vi.fn() },
  redraftMatchup: { findFirst: vi.fn(), update: vi.fn() },
  redraftSeason: { findFirst: vi.fn() },
  redraftRosterPlayer: { findMany: vi.fn() },
  playerWeeklyScore: { findUnique: vi.fn() },
  roster: { findMany: vi.fn(async () => []) },
  afRosterLineupAssignment: { findMany: vi.fn(async () => []) },
  leaguePlayerWeeklyScore: { deleteMany: vi.fn(), upsert: vi.fn() },
  $transaction: vi.fn(),
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('@/lib/devy/scoringEligibilityEngine', () => ({
  leagueUsesDevyEngine: vi.fn(async () => false),
  calculateOfficialTeamScore: vi.fn(),
}))
vi.mock('@/lib/c2c/scoringEngine', () => ({ leagueUsesC2CEngine: vi.fn(async () => false), updateC2CMatchupScores: vi.fn() }))
vi.mock('@/lib/events', () => ({ getPlatformEvents: () => ({ emit: vi.fn(async () => undefined) }), EVENT: {} }))
vi.mock('@/lib/sports-evidence/gates', () => ({ isSportsDataEnabled: () => false }))

import {
  NATIVE_PLAYER_SCORE_SOURCE,
  nativeRosterSeat,
  nativeSeatMap,
  writeNativePlayerWeeklyScores,
} from '@/lib/redraft/nativePlayerWeeklyScores'
import { calculateScoreFromSportConfig, updateMatchupScores } from '@/lib/redraft/scoringEngine'

/* Distinct on purpose: OUR League.id, and the synthetic platform id a native league carries. */
const LEAGUE_ID = '6f1c2b9e-league-uuid'
const PLATFORM_LEAGUE_ID = 'manual-1726000000000'

type Row = {
  leagueId: string
  seasonYear: number
  week: number
  playerId: string
  rosterId: number | null
  isStarter: boolean
  points: number
  isFinalized: boolean
  source: string
}

/** An in-memory `league_player_weekly_scores` honouring the unique key and the two calls the writer makes. */
function fakeTable() {
  const rows = new Map<string, Row>()
  const k = (r: { leagueId: string; seasonYear: number; week: number; playerId: string }) =>
    `${r.leagueId}|${r.seasonYear}|${r.week}|${r.playerId}`
  const table = {
    rows,
    leaguePlayerWeeklyScore: {
      deleteMany: vi.fn(async ({ where }: { where: Record<string, any> }) => {
        let count = 0
        for (const [key, r] of rows) {
          if (
            r.leagueId === where.leagueId &&
            r.seasonYear === where.seasonYear &&
            r.week === where.week &&
            r.rosterId === where.rosterId &&
            r.source === where.source &&
            !where.playerId.notIn.includes(r.playerId)
          ) {
            rows.delete(key)
            count += 1
          }
        }
        return { count }
      }),
      upsert: vi.fn(async ({ where, create, update }: { where: any; create: Row; update: Partial<Row> }) => {
        const key = k(where.leagueId_seasonYear_week_playerId)
        const cur = rows.get(key)
        rows.set(key, cur ? { ...cur, ...update } : { ...create })
        return rows.get(key)
      }),
    },
    $transaction: vi.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
  }
  return table
}

beforeEach(() => vi.clearAllMocks())

describe('nativeRosterSeat', () => {
  it('is a stable positive Postgres integer, and differs across rosters', () => {
    const a = nativeRosterSeat('cm1rosteraaaa')
    expect(a).toBe(nativeRosterSeat('cm1rosteraaaa'))
    expect(Number.isInteger(a) && a >= 0 && a <= 0x7fffffff).toBe(true)
    expect(nativeRosterSeat('cm1rosterbbbb')).not.toBe(a)
  })

  it('a seat two rosters share is dropped from the map, not guessed', () => {
    expect(nativeSeatMap(['r1', 'r2']).get(nativeRosterSeat('r1'))).toBe('r1')
    // A real collision, found by birthday search over `roster<n>`: both hash to 888198018.
    expect(nativeRosterSeat('roster498904')).toBe(nativeRosterSeat('roster848220'))
    const m = nativeSeatMap(['roster498904', 'roster848220', 'r1'])
    expect(m.has(nativeRosterSeat('roster498904'))).toBe(false)
    expect(m.get(nativeRosterSeat('r1'))).toBe('r1')
    // The same roster listed twice is not a collision.
    expect(nativeSeatMap(['r1', 'r1']).get(nativeRosterSeat('r1'))).toBe('r1')
  })
})

describe('writeNativePlayerWeeklyScores', () => {
  const base = { leagueId: LEAGUE_ID, seasonYear: 2026, week: 4, redraftRosterId: 'cm1home' }

  it('writes starters and bench under OUR League.id with source allfantasy, and is idempotent', async () => {
    const t = fakeTable()
    const players = [
      { playerId: 'p-qb', points: 24.567, isStarter: true },
      { playerId: 'p-bench', points: 11, isStarter: false },
    ]
    await writeNativePlayerWeeklyScores(t as never, { ...base, players, isFinalized: true })
    await writeNativePlayerWeeklyScores(t as never, { ...base, players, isFinalized: true })

    expect(t.rows.size).toBe(2)
    const qb = [...t.rows.values()].find((r) => r.playerId === 'p-qb')!
    expect(qb).toMatchObject({
      leagueId: LEAGUE_ID,
      rosterId: nativeRosterSeat('cm1home'),
      isStarter: true,
      points: 24.57,
      isFinalized: true,
      source: NATIVE_PLAYER_SCORE_SOURCE,
    })
    expect([...t.rows.values()].find((r) => r.playerId === 'p-bench')).toMatchObject({ isStarter: false, points: 11 })
    expect([...t.rows.values()].some((r) => r.leagueId === PLATFORM_LEAGUE_ID)).toBe(false)
  })

  it('a rescore overwrites points and starter flag, and removes a player it no longer lists', async () => {
    const t = fakeTable()
    await writeNativePlayerWeeklyScores(t as never, {
      ...base,
      players: [
        { playerId: 'p-qb', points: 20, isStarter: true },
        { playerId: 'p-dropped', points: 5, isStarter: true },
      ],
      isFinalized: false,
    })
    await writeNativePlayerWeeklyScores(t as never, {
      ...base,
      players: [{ playerId: 'p-qb', points: 22.5, isStarter: false }],
      isFinalized: true,
    })
    expect([...t.rows.values()]).toEqual([
      expect.objectContaining({ playerId: 'p-qb', points: 22.5, isStarter: false, isFinalized: true }),
    ])
  })

  it('never deletes the other roster of the matchup, nor another week', async () => {
    const t = fakeTable()
    await writeNativePlayerWeeklyScores(t as never, { ...base, players: [{ playerId: 'p1', points: 1, isStarter: true }], isFinalized: true })
    await writeNativePlayerWeeklyScores(t as never, {
      ...base,
      redraftRosterId: 'cm1away',
      players: [{ playerId: 'p2', points: 2, isStarter: true }],
      isFinalized: true,
    })
    await writeNativePlayerWeeklyScores(t as never, { ...base, week: 5, players: [], isFinalized: true })
    expect([...t.rows.values()].map((r) => r.playerId).sort()).toEqual(['p1', 'p2'])
  })

  it('a player listed twice keeps the starter row', async () => {
    const t = fakeTable()
    await writeNativePlayerWeeklyScores(t as never, {
      ...base,
      players: [
        { playerId: 'p1', points: 3, isStarter: false },
        { playerId: 'p1', points: 9, isStarter: true },
      ],
      isFinalized: true,
    })
    expect([...t.rows.values()]).toEqual([expect.objectContaining({ playerId: 'p1', points: 9, isStarter: true })])
  })
})

describe('updateMatchupScores → league_player_weekly_scores', () => {
  type P = { playerId: string; position: string; slotType: string; yards: number }
  const HOME: P[] = [
    { playerId: 'h-qb', position: 'QB', slotType: 'QB', yards: 80 },
    { playerId: 'h-rb', position: 'RB', slotType: 'RB', yards: 60 },
    { playerId: 'h-wr', position: 'WR', slotType: 'WR', yards: 40 },
    { playerId: 'h-bench', position: 'RB', slotType: 'BN', yards: 120 },
    // IR scores for neither side and is not written.
    { playerId: 'h-ir', position: 'WR', slotType: 'IR', yards: 300 },
  ]
  const AWAY: P[] = [{ playerId: 'a-wr', position: 'WR', slotType: 'WR', yards: 30 }]
  const SETTINGS = {
    sportConfig: { scoringPreset: 'PPR' },
    roster: { config: { sections: [{ slots: { QB: 1, RB: 1, WR: 1, BN: 3, IR: 1 } }] } },
  }

  function arrange(league: Record<string, unknown>, matchup: Record<string, unknown> = {}) {
    const t = fakeTable()
    db.leaguePlayerWeeklyScore.deleteMany.mockImplementation(t.leaguePlayerWeeklyScore.deleteMany)
    db.leaguePlayerWeeklyScore.upsert.mockImplementation(t.leaguePlayerWeeklyScore.upsert)
    db.$transaction.mockImplementation(t.$transaction)
    db.league.findFirst.mockResolvedValue({ sport: 'NFL', settings: SETTINGS, platform: 'manual', ...league })
    db.redraftMatchup.findFirst.mockResolvedValue({
      id: 'm1',
      leagueId: LEAGUE_ID,
      seasonId: 's1',
      week: 4,
      homeRosterId: 'cm1home',
      awayRosterId: 'cm1away',
      homeRoster: {},
      homeScore: 0,
      awayScore: 0,
      status: 'active',
      ...matchup,
    })
    db.redraftSeason.findFirst.mockResolvedValue({ id: 's1', season: 2026, sport: 'NFL' })
    db.redraftRosterPlayer.findMany.mockImplementation(async ({ where }: { where: { rosterId: string } }) =>
      (where.rosterId === 'cm1home' ? HOME : AWAY).map((p) => ({ ...p, rosterId: where.rosterId, sport: 'NFL', playerName: p.playerId, droppedAt: null })),
    )
    db.playerWeeklyScore.findUnique.mockImplementation(async ({ where }: { where: { playerId_week_season_sport: { playerId: string } } }) => {
      const p = [...HOME, ...AWAY].find((x) => x.playerId === where.playerId_week_season_sport.playerId)!
      return { stats: { rush_yds: p.yards }, isFinalized: true }
    })
    db.redraftMatchup.update.mockResolvedValue({})
    return t
  }

  const pts = (p: P) => calculateScoreFromSportConfig(LEAGUE_ID, p.playerId, 4, { rush_yds: p.yards }, p.position)

  it('a native lineup league writes every starter and bench player, final, and keeps them out of lineupSnapshots', async () => {
    const t = arrange({ bestBallMode: false, leagueType: 'redraft', leagueVariant: null })
    await updateMatchupScores('m1')

    const rows = [...t.rows.values()]
    expect(rows.map((r) => r.playerId).sort()).toEqual(['a-wr', 'h-bench', 'h-qb', 'h-rb', 'h-wr'])
    expect(rows.every((r) => r.leagueId === LEAGUE_ID && r.isFinalized && r.source === 'allfantasy')).toBe(true)
    const bench = rows.find((r) => r.playerId === 'h-bench')!
    expect(bench).toMatchObject({ isStarter: false, rosterId: nativeRosterSeat('cm1home'), points: await pts(HOME[3]!) })
    expect(rows.find((r) => r.playerId === 'a-wr')!.rosterId).toBe(nativeRosterSeat('cm1away'))
    // The starter rows sum to the team's score — the same number the matchup shows.
    const data = db.redraftMatchup.update.mock.calls[0]![0].data
    const starterSum = rows.filter((r) => r.rosterId === nativeRosterSeat('cm1home') && r.isStarter).reduce((n, r) => n + r.points, 0)
    expect(Math.round(starterSum * 100) / 100).toBe(data.homeScore)
    expect(data.lineupSnapshots.redraftScoring.home.playerPoints).toBeUndefined()
  })

  it('best ball marks the lineup the system started as starters', async () => {
    const t = arrange({ bestBallMode: true, leagueType: 'best_ball', leagueVariant: null })
    await updateMatchupScores('m1')
    const homeRows = [...t.rows.values()].filter((r) => r.rosterId === nativeRosterSeat('cm1home'))
    // RB seat: the benched back outgained the slotted one, so best ball starts him instead.
    expect(homeRows.find((r) => r.playerId === 'h-bench')!.isStarter).toBe(true)
    expect(homeRows.find((r) => r.playerId === 'h-rb')!.isStarter).toBe(false)
  })

  it('an imported league scored by this engine writes nothing — its rows belong to its platform', async () => {
    const t = arrange({ platform: 'fantrax', bestBallMode: false, leagueType: 'redraft', leagueVariant: null })
    await updateMatchupScores('m1')
    expect(t.rows.size).toBe(0)
    expect(db.$transaction).not.toHaveBeenCalled()
  })

  it('a no-op live recalc of an unchanged, not-final week does not rewrite rows', async () => {
    db.playerWeeklyScore.findUnique.mockReset()
    const t = arrange({ bestBallMode: false, leagueType: 'redraft', leagueVariant: null })
    db.playerWeeklyScore.findUnique.mockImplementation(async ({ where }: { where: { playerId_week_season_sport: { playerId: string } } }) => {
      const p = [...HOME, ...AWAY].find((x) => x.playerId === where.playerId_week_season_sport.playerId)!
      return { stats: { rush_yds: p.yards }, isFinalized: false }
    })
    const homeScore = Math.round(((await pts(HOME[0]!)) + (await pts(HOME[1]!)) + (await pts(HOME[2]!))) * 100) / 100
    const awayScore = Math.round((await pts(AWAY[0]!)) * 100) / 100
    db.redraftMatchup.findFirst.mockResolvedValue({
      id: 'm1', leagueId: LEAGUE_ID, seasonId: 's1', week: 4, homeRosterId: 'cm1home', awayRosterId: 'cm1away',
      homeRoster: {}, homeScore, awayScore, status: 'active',
    })
    await updateMatchupScores('m1')
    expect(t.rows.size).toBe(0)
  })

  it('a failed write never fails the matchup score', async () => {
    arrange({ bestBallMode: false, leagueType: 'redraft', leagueVariant: null })
    db.$transaction.mockRejectedValue(new Error('table missing'))
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const summary = await updateMatchupScores('m1')
    expect(summary?.homeScore).toBeGreaterThan(0)
    expect(err).toHaveBeenCalled()
    err.mockRestore()
  })
})

/**
 * Week-by-week rosters (lib/redraft/rosterWeekHistory.ts), driven through the REAL scorer.
 *
 * A trade MOVES the RedraftRosterPlayer row to the other team, so re-scoring an old week from the
 * current roster takes a player's points off the team that played him and hands them to the team that
 * did not have him yet. The scorer now records the roster it scored and freezes it when the matchup
 * goes final; a re-score of that week (a stat correction, a commish lineup edit) uses the record.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Row = { playerId: string; position: string; slotType: string }
const h = vi.hoisted(() => ({
  current: { home: [] as Row[], away: [] as Row[] },
  weeks: new Map<string, { rosterId: string; seasonId: string; week: number; players: unknown; frozen: boolean }>(),
  finalized: true,
  tableMissing: false,
}))

const missing = () => Object.assign(new Error('The table `redraft_roster_weeks` does not exist'), { code: 'P2021' })
const db = vi.hoisted(() => ({
  league: { findFirst: vi.fn() },
  redraftMatchup: { findFirst: vi.fn(), update: vi.fn(async () => ({})) },
  redraftSeason: { findFirst: vi.fn() },
  redraftRosterPlayer: { findMany: vi.fn() },
  redraftRosterWeek: { findUnique: vi.fn(), updateMany: vi.fn(), create: vi.fn(), upsert: vi.fn() },
  playerWeeklyScore: { findUnique: vi.fn() },
  roster: { findMany: vi.fn(async () => []) },
  afRosterLineupAssignment: { findMany: vi.fn(async () => []) },
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('@/lib/devy/scoringEligibilityEngine', () => ({ leagueUsesDevyEngine: vi.fn(async () => false), calculateOfficialTeamScore: vi.fn() }))
vi.mock('@/lib/c2c/scoringEngine', () => ({ leagueUsesC2CEngine: vi.fn(async () => false), updateC2CMatchupScores: vi.fn() }))
vi.mock('@/lib/events', () => ({ getPlatformEvents: () => ({ emit: vi.fn(async () => undefined) }), EVENT: {} }))
vi.mock('@/lib/sports-evidence/gates', () => ({ isSportsDataEnabled: () => false }))

import { calculateScoreFromSportConfig, updateMatchupScores } from '@/lib/redraft/scoringEngine'
import { recordWeekRoster, replaceFrozenWeekRoster, rosterPlayersForWeek } from '@/lib/redraft/rosterWeekHistory'

const STATS: Record<string, Record<string, number>> = { w1: { rec_yds: 100 }, r1: { rush_yds: 50 }, t1: { rec_yds: 70 } }
const key = (rosterId: string, week: number) => `${rosterId}:${week}`

beforeEach(() => {
  vi.clearAllMocks()
  h.weeks.clear()
  h.finalized = true
  h.tableMissing = false
  h.current = {
    home: [{ playerId: 'w1', position: 'WR', slotType: 'WR' }],
    away: [{ playerId: 'r1', position: 'RB', slotType: 'RB' }, { playerId: 't1', position: 'TE', slotType: 'BENCH' }],
  }
  db.league.findFirst.mockResolvedValue({ sport: 'NFL', settings: { sportConfig: { scoringPreset: 'PPR' } }, bestBallMode: false, leagueType: 'redraft', leagueVariant: null })
  db.redraftMatchup.findFirst.mockResolvedValue({ id: 'm1', leagueId: 'L1', seasonId: 's1', week: 3, homeRosterId: 'home', awayRosterId: 'away', homeRoster: {}, homeScore: 0, awayScore: 0 })
  db.redraftSeason.findFirst.mockResolvedValue({ id: 's1', season: 2026, sport: 'NFL' })
  db.redraftRosterPlayer.findMany.mockImplementation(async ({ where }: { where: { rosterId: 'home' | 'away' } }) =>
    h.current[where.rosterId].map((p) => ({ ...p, rosterId: where.rosterId, sport: 'NFL', playerName: p.playerId, team: null })),
  )
  db.playerWeeklyScore.findUnique.mockImplementation(async ({ where }: { where: { playerId_week_season_sport: { playerId: string } } }) => ({
    stats: STATS[where.playerId_week_season_sport.playerId],
    isFinalized: h.finalized,
  }))
  db.redraftRosterWeek.findUnique.mockImplementation(async ({ where }: { where: { rosterId_week: { rosterId: string; week: number } } }) => {
    if (h.tableMissing) throw missing()
    return h.weeks.get(key(where.rosterId_week.rosterId, where.rosterId_week.week)) ?? null
  })
  db.redraftRosterWeek.updateMany.mockImplementation(async ({ where, data }: { where: { rosterId: string; week: number; frozen: boolean }; data: Record<string, unknown> }) => {
    if (h.tableMissing) throw missing()
    const row = h.weeks.get(key(where.rosterId, where.week))
    if (!row || row.frozen !== where.frozen) return { count: 0 }
    Object.assign(row, data)
    return { count: 1 }
  })
  db.redraftRosterWeek.create.mockImplementation(async ({ data }: { data: { rosterId: string; seasonId: string; week: number; players: unknown; frozen: boolean } }) => {
    if (h.tableMissing) throw missing()
    if (h.weeks.has(key(data.rosterId, data.week))) throw Object.assign(new Error('unique'), { code: 'P2002' })
    h.weeks.set(key(data.rosterId, data.week), { ...data })
    return data
  })
  db.redraftRosterWeek.upsert.mockImplementation(async ({ create, update, where }: { create: { rosterId: string; seasonId: string; week: number; players: unknown; frozen: boolean }; update: Record<string, unknown>; where: { rosterId_week: { rosterId: string; week: number } } }) => {
    const k = key(where.rosterId_week.rosterId, where.rosterId_week.week)
    const row = h.weeks.get(k)
    if (row) Object.assign(row, update)
    else h.weeks.set(k, { ...create })
    return h.weeks.get(k)
  })
})

const pts = (id: string, pos: string) => calculateScoreFromSportConfig('L1', id, 3, STATS[id]!, pos).then((n) => Math.round(n * 100) / 100)

/** The week-5 trade: home's w1 goes to away (the row MOVES), and away starts him. */
function tradeW1ToAway() {
  h.current.home = []
  h.current.away = [...h.current.away, { playerId: 'w1', position: 'WR', slotType: 'WR' }]
}

describe('the scorer records and freezes the roster it scored', () => {
  it('a final pass freezes both sides', async () => {
    await updateMatchupScores('m1')
    expect(h.weeks.get('home:3')).toMatchObject({ seasonId: 's1', frozen: true })
    expect((h.weeks.get('home:3')!.players as Array<{ playerId: string }>).map((p) => p.playerId)).toEqual(['w1'])
    expect((h.weeks.get('away:3')!.players as Array<{ playerId: string }>).map((p) => p.playerId)).toEqual(['r1', 't1'])
    expect(h.weeks.get('away:3')!.frozen).toBe(true)
  })

  it('a live pass records without freezing, and the next pass follows a roster change', async () => {
    h.finalized = false
    await updateMatchupScores('m1')
    expect(h.weeks.get('home:3')!.frozen).toBe(false)
    tradeW1ToAway()
    await updateMatchupScores('m1')
    expect(h.weeks.get('home:3')!.players).toEqual([])
  })

  it('re-scoring a sealed week after a trade uses the roster that week was played with', async () => {
    const w1 = await pts('w1', 'WR')
    const r1 = await pts('r1', 'RB')
    const first = await updateMatchupScores('m1')
    expect(first).toMatchObject({ homeScore: w1, awayScore: r1 })

    tradeW1ToAway()
    const again = await updateMatchupScores('m1')
    // w1 still counts for home in week 3, and does NOT count for away, who did not have him yet.
    expect(again).toMatchObject({ homeScore: w1, awayScore: r1 })
    expect((h.weeks.get('home:3')!.players as Array<{ playerId: string }>).map((p) => p.playerId)).toEqual(['w1'])
  })

  it('without the table (migration not applied) scoring falls back to the current roster and does not throw', async () => {
    h.tableMissing = true
    const r1 = await pts('r1', 'RB')
    const w1 = await pts('w1', 'WR')
    tradeW1ToAway()
    const summary = await updateMatchupScores('m1')
    expect(summary).toMatchObject({ homeScore: 0, awayScore: Math.round((r1 + w1) * 100) / 100 })
  })
})

describe('rosterWeekHistory', () => {
  const P = (playerId: string) => ({ playerId, playerName: playerId, position: 'WR', team: null, sport: 'NFL', slotType: 'WR' })

  it('a scoring pass never overwrites a frozen week; the commish replacement does', async () => {
    await recordWeekRoster({ rosterId: 'home', seasonId: 's1', week: 3, players: [P('a')], freeze: true })
    await recordWeekRoster({ rosterId: 'home', seasonId: 's1', week: 3, players: [P('b')], freeze: true })
    expect((await rosterPlayersForWeek('home', 3)).players.map((p) => p.playerId)).toEqual(['a'])

    expect(await replaceFrozenWeekRoster({ rosterId: 'home', seasonId: 's1', week: 3, players: [P('c')] })).toBe(true)
    const r = await rosterPlayersForWeek('home', 3)
    expect(r.frozen).toBe(true)
    expect(r.players).toEqual([{ ...P('c'), rosterId: 'home' }])
  })

  it('an unfrozen or unreadable record means the current roster', async () => {
    await recordWeekRoster({ rosterId: 'home', seasonId: 's1', week: 4, players: [P('zz')], freeze: false })
    expect((await rosterPlayersForWeek('home', 4)).frozen).toBe(false)
    expect((await rosterPlayersForWeek('home', 4)).players.map((p) => p.playerId)).toEqual(['w1'])

    h.weeks.set('home:5', { rosterId: 'home', seasonId: 's1', week: 5, players: 'garbage', frozen: true })
    expect((await rosterPlayersForWeek('home', 5)).frozen).toBe(false)
  })
})

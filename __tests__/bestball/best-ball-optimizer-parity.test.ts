/**
 * Every best ball lineup number in the app must equal production's (audit 2026-11-06, finding #17 / #22).
 *
 * Production truth: `computeOptimalLineup` over `buildBestBallSlots(sport, league.settings)` — exactly what
 * `scoreRosterBestBall` (lib/redraft/scoringEngine.ts) seats. One shared fixture set runs through every
 * repointed path and each must return the SAME total and the SAME seated players:
 *   - `seatContestLineup` / `runGreedyOptimizer` (lib/bestball/optimizerCore.ts — contests, survivor,
 *     the optimize cache);
 *   - `optimizeBestBallLeagueLineup` (lib/bestball/leagueOptimizer.ts — server/services/weeklyProcessor.ts);
 *   - `selectBestBallLineupForRoster` (lib/scoring/best-ball-engine.ts — the scoring worker);
 *   - `runBestBallOptimizer`'s league-roster path (lib/bestball/optimizer.ts — the cache survivor reads);
 *   - the slot counts `lib/bestball/rules.ts` and the War Room state.
 *
 * Fixtures: NFL with FLEX + SUPERFLEX + K + DEF (a DST-listed defense), the NBA dual-eligible case the audit
 * measured (greedy 35, optimal 50), the full NBA template with dual-eligible guards/forwards, and a
 * 30-player MLB roster (which the old DFS took 18 s on) with a 1 s budget.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  statRows: [] as Array<{ playerId: string; fantasyPoints: number }>,
  positions: new Map<string, string>(),
  scoreRosterForWeek: vi.fn(),
  rosterFindFirst: vi.fn(),
  leagueFindFirst: vi.fn(),
  cacheFindFirst: vi.fn(),
  cacheCreate: vi.fn(async (args: { data: unknown }) => args.data),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    playerGameStat: { findMany: vi.fn(async () => m.statRows) },
    redraftRoster: { findFirst: (...a: unknown[]) => m.rosterFindFirst(...a) },
    league: { findFirst: (...a: unknown[]) => m.leagueFindFirst(...a), findUnique: vi.fn(async () => null) },
    bestBallOptimizedLineup: {
      findFirst: (...a: unknown[]) => m.cacheFindFirst(...a),
      create: (args: { data: unknown }) => m.cacheCreate(args),
      update: vi.fn(),
    },
  },
}))
vi.mock('@/lib/player-identity/findSportsPlayerByLeagueId', () => ({
  findSportsPlayersForLeague: vi.fn(async (_sport: string, _platform: string, ids: readonly string[]) =>
    new Map(ids.filter((id) => m.positions.has(id)).map((id) => [id, { name: id, position: m.positions.get(id)!, team: null }])),
  ),
}))
/*
 * The scoring worker refuses the daily sports outright (their game stats carry no week). That gate is
 * tested in scorers-fail-closed; here it is lifted so the LINEUP half can be compared for every sport.
 */
vi.mock('@/lib/multi-sport/MultiSportMatchupScoringService', () => ({ weekKeyedStatsUnavailableReason: () => null }))
vi.mock('@/lib/redraft/scoringEngine', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/redraft/scoringEngine')>()),
  scoreRosterForWeek: (...a: unknown[]) => m.scoreRosterForWeek(...a),
}))

import { computeOptimalLineup, type OptimalLineupResult } from '@/lib/lineup-optimizer/optimalLineup'
import { buildBestBallSlots } from '@/lib/redraft/scoringEngine'
import { normalizeToken } from '@/lib/redraft/lineupValidation'
import { bestBallTemplateSettings } from '@/lib/bestball/productionLineup'
import { seatContestLineup, runGreedyOptimizer } from '@/lib/bestball/optimizerCore'
import { optimizeBestBallLeagueLineup } from '@/lib/bestball/leagueOptimizer'
import { selectBestBallLineupForRoster } from '@/lib/scoring/best-ball-engine'
import { runBestBallOptimizer } from '@/lib/bestball/optimizer'
import { getBestBallSportProfile } from '@/lib/bestball/rules'
import { bestBallTemplateSeats } from '@/lib/league-defaults/bestBallTemplateRounds'
import { buildRosterSettings } from '@/lib/best-ball-war-room/bestBallWarRoomContext'
import type { LineupSlotDef } from '@/lib/bestball/types'

type RosterPlayer = { playerId: string; position: string; points: number }
type Fixture = { name: string; sport: string; settings: unknown; players: RosterPlayer[] }

const roster = (sections: Record<string, number>) => ({ roster: { config: { sections: [{ key: 'primary', slots: sections }] } } })

/** A small deterministic generator, so the MLB roster is fixed without hand-writing 30 numbers. */
function seeded(seed: number) {
  let s = seed
  return () => {
    s = (s * 1103515245 + 12345) % 2147483648
    return s / 2147483648
  }
}

const MLB_POSITIONS = [
  'C', 'C', '1B', '1B/3B', '2B', '2B/SS', 'SS', '3B', '3B/1B', 'OF', 'OF', 'OF', 'OF', 'OF', 'OF', 'OF/1B', 'DH',
  'SP', 'SP', 'SP', 'SP', 'SP', 'SP/RP', 'RP', 'RP', 'RP', 'RP', 'SS/2B', 'C/1B', 'OF',
]
const rand = seeded(17)
const MLB_30: RosterPlayer[] = MLB_POSITIONS.map((position, i) => ({
  playerId: `mlb${String(i).padStart(2, '0')}`,
  position,
  points: Math.round(rand() * 400) / 10,
}))

const FIXTURES: Fixture[] = [
  {
    name: 'NFL with FLEX + SUPERFLEX + K + DEF',
    sport: 'NFL',
    settings: roster({ QB: 1, RB: 2, WR: 3, TE: 1, FLEX: 1, SUPERFLEX: 1, K: 1, DEF: 1, BN: 6 }),
    players: [
      { playerId: 'QB_A', position: 'QB', points: 30 },
      { playerId: 'QB_B', position: 'QB', points: 26 },
      { playerId: 'QB_C', position: 'QB', points: 4 },
      { playerId: 'RB1', position: 'RB', points: 22 },
      { playerId: 'RB2', position: 'RB', points: 15 },
      { playerId: 'RB3', position: 'RB', points: 14 },
      { playerId: 'RBWR', position: 'RB/WR', points: 20 },
      { playerId: 'WR1', position: 'WR', points: 25 },
      { playerId: 'WR2', position: 'WR', points: 18 },
      { playerId: 'WR3', position: 'WR', points: 12 },
      { playerId: 'WR4', position: 'WR', points: 11 },
      { playerId: 'TE1', position: 'TE', points: 9 },
      { playerId: 'TE2', position: 'TE', points: 13 },
      { playerId: 'K1', position: 'K', points: 8 },
      { playerId: 'DST1', position: 'DST', points: 7 },
    ],
  },
  {
    name: 'NBA dual-eligible (the audit case: greedy 35, optimal 50)',
    sport: 'NBA',
    settings: roster({ PG: 1, SG: 1, BN: 3 }),
    players: [
      { playerId: 'A', position: 'PG/SG', points: 30 },
      { playerId: 'B', position: 'PG', points: 20 },
      { playerId: 'C', position: 'SG', points: 5 },
    ],
  },
  {
    name: 'NBA best_ball template with dual-eligible guards and forwards',
    sport: 'NBA',
    settings: bestBallTemplateSettings('NBA'),
    players: [
      { playerId: 'g1', position: 'PG/SG', points: 52 },
      { playerId: 'g2', position: 'PG', points: 40 },
      { playerId: 'g3', position: 'SG', points: 12 },
      { playerId: 'g4', position: 'SG/SF', points: 33 },
      { playerId: 'f1', position: 'SF/PF', points: 48 },
      { playerId: 'f2', position: 'PF', points: 21 },
      { playerId: 'f3', position: 'SF', points: 9 },
      { playerId: 'f4', position: 'PF/C', points: 37 },
      { playerId: 'c1', position: 'C', points: 44 },
      { playerId: 'c2', position: 'C', points: 18 },
      { playerId: 'c3', position: 'C', points: 6 },
      { playerId: 'u1', position: 'PG', points: 27 },
      { playerId: 'u2', position: 'SF', points: 30 },
      { playerId: 'u3', position: 'PF', points: 3 },
      { playerId: 'u4', position: 'SG', points: 15 },
    ],
  },
  { name: 'MLB 30-player roster on the best_ball template', sport: 'MLB', settings: bestBallTemplateSettings('MLB'), players: MLB_30 },
]

/** Production: the exact optimizer over the league's slots, positions normalized the way scoring does. */
function production(f: Fixture): OptimalLineupResult {
  return computeOptimalLineup({
    slots: buildBestBallSlots(f.sport, f.settings),
    players: f.players.map((p) => ({
      playerId: p.playerId,
      positions: p.position.split(/[/,]/).map((x) => normalizeToken(x)).filter(Boolean),
      points: p.points,
    })),
  })
}

const seatedOf = (r: OptimalLineupResult) => r.assignments.map((a) => a.playerId).sort()
const sorted = (ids: string[]) => [...ids].sort()

function timed<T>(fn: () => T): { value: T; ms: number } {
  const t0 = performance.now()
  const value = fn()
  return { value, ms: performance.now() - t0 }
}
async function timedAsync<T>(fn: () => Promise<T>): Promise<{ value: T; ms: number }> {
  const t0 = performance.now()
  const value = await fn()
  return { value, ms: performance.now() - t0 }
}

beforeEach(() => {
  m.statRows = []
  m.positions = new Map()
  vi.clearAllMocks()
})

describe('the fixtures pin production', () => {
  it('the NFL superflex seat takes the second quarterback, and a DST-listed defense fills DEF', () => {
    const r = production(FIXTURES[0]!)
    const bySlot = new Map(r.assignments.map((a) => [`${a.slot}#${a.seat}`, a.playerId]))
    // Both quarterbacks start: one in QB, the second in the superflex seat (which one sits where is a tie).
    expect([bySlot.get('QB#1'), bySlot.get('SF#1')].sort()).toEqual(['QB_A', 'QB_B'])
    expect(bySlot.get('DEF#1')).toBe('DST1')
    expect(bySlot.get('K#1')).toBe('K1')
    expect(r.unfilledSlots).toEqual([])
  })

  it('the NBA dual-eligible case is 50, not 35', () => {
    expect(production(FIXTURES[1]!).total).toBe(50)
  })
})

describe.each(FIXTURES)('$name', (f) => {
  const expected = production(f)

  it('optimizerCore (contests, survivor, the optimize cache) returns the same lineup, fast', () => {
    const slots: LineupSlotDef[] = buildBestBallSlots(f.sport, f.settings).map((s) => ({ slot: s.slot, eligible: [...s.eligible], count: s.count }))
    const players = f.players.map((p) => ({ ...p, playerName: p.playerId }))
    const { value: r, ms } = timed(() => seatContestLineup(players, slots, f.sport))
    expect(r.totalPoints).toBe(expected.total)
    expect(sorted(r.assignments.map((a) => a.player.playerId))).toEqual(seatedOf(expected))
    expect(sorted(runGreedyOptimizer(players, slots, f.sport).assignments.map((a) => a.player.playerId))).toEqual(seatedOf(expected))
    expect(ms).toBeLessThan(1000)
  })

  it('leagueOptimizer (the weekly processor) seats the league slots and returns the same lineup, fast', () => {
    const players = f.players.map((p) => ({ ...p, playerName: p.playerId }))
    const { value: r, ms } = timed(() => optimizeBestBallLeagueLineup(f.sport, players, f.settings))
    expect(r.totalPoints).toBe(expected.total)
    expect(sorted(r.starterIds)).toEqual(seatedOf(expected))
    expect(sorted(r.benchIds)).toEqual(sorted(f.players.map((p) => p.playerId).filter((id) => !seatedOf(expected).includes(id))))
    expect(ms).toBeLessThan(1000)
  }, 30_000)

  it('best-ball-engine (the scoring worker) returns the same lineup, fast', async () => {
    m.statRows = f.players.map((p) => ({ playerId: p.playerId, fantasyPoints: p.points }))
    m.positions = new Map(f.players.map((p) => [p.playerId, p.position]))
    const { value: r, ms } = await timedAsync(() =>
      selectBestBallLineupForRoster({
        leagueId: 'L',
        leagueSport: f.sport as never,
        season: 2026,
        weekOrRound: 3,
        rosterPlayerIds: f.players.map((p) => p.playerId),
        platform: 'sleeper',
        leagueSettings: f.settings,
      }),
    )
    expect(r.status).toBe('AVAILABLE')
    expect(r.totalProjectedPoints).toBe(expected.total)
    expect(sorted(r.starterIds)).toEqual(seatedOf(expected))
    expect(ms).toBeLessThan(1000)
  }, 30_000)

  it('runBestBallOptimizer caches exactly the lineup production scored for the league roster', async () => {
    const seated = new Set(seatedOf(expected))
    m.rosterFindFirst.mockResolvedValue({
      id: 'R1',
      leagueId: 'L',
      seasonId: 'S1',
      season: { season: 2026 },
      players: f.players.map((p) => ({ playerId: p.playerId, playerName: p.playerId, position: p.position })),
    })
    m.leagueFindFirst.mockResolvedValue({ sport: f.sport, settings: f.settings, bbOptimizerTiming: 'final' })
    m.cacheFindFirst.mockResolvedValue(null)
    m.scoreRosterForWeek.mockResolvedValue({
      rosterId: 'R1',
      starterCount: f.players.length,
      scoredStarterCount: f.players.length,
      points: expected.total,
      missingPlayerIds: [],
      allFinal: true,
      bestBall: { assignments: expected.assignments, unfilledSlots: expected.unfilledSlots },
      playerPoints: f.players.map((p) => ({ playerId: p.playerId, points: p.points, isStarter: seated.has(p.playerId) })),
    })

    const row = (await runBestBallOptimizer({ rosterId: 'R1', leagueId: 'L', week: 3, sport: f.sport })) as unknown as {
      totalPoints: number
      starterIds: string[]
      benchIds: string[]
      isFinalized: boolean
      lineupBreakdown: Array<{ playerId: string; slot: string; wasUsed: boolean }>
    }
    expect(m.scoreRosterForWeek).toHaveBeenCalledWith(expect.objectContaining({ leagueId: 'L', rosterId: 'R1', week: 3, seasonYear: 2026 }))
    expect(row.totalPoints).toBe(expected.total)
    expect(sorted(row.starterIds)).toEqual(seatedOf(expected))
    expect(sorted(row.benchIds)).toEqual(sorted(f.players.map((p) => p.playerId).filter((id) => !seated.has(id))))
    expect(row.isFinalized).toBe(true)
    const slotOf = new Map(expected.assignments.map((a) => [a.playerId, a.slot]))
    for (const b of row.lineupBreakdown) expect(b.slot).toBe(b.wasUsed ? slotOf.get(b.playerId) : 'bench')
  })
})

describe('slot counts shown to users match the slots production scores', () => {
  const seats = (sport: string, settings: unknown) => buildBestBallSlots(sport, settings).reduce((n, s) => n + s.count, 0)
  const shown = (sport: string, settings?: unknown) =>
    getBestBallSportProfile(sport, settings).lineupSlots.reduce((n, s) => n + s.count, 0)

  it.each(['NFL', 'NBA', 'MLB', 'NHL', 'NCAAF', 'NCAAB', 'SOCCER'])('%s: the sport profile states the best_ball template seats', (sport) => {
    expect(shown(sport)).toBe(seats(sport, bestBallTemplateSettings(sport)))
  })

  it('NBA / NHL / MLB: the profile agrees with the template seat count read independently (bestBallTemplateSeats)', () => {
    // The old hand-written profile said 9 / 9 / 17; the template a league is given has 11 / 14 / 23.
    expect(shown('NBA')).toBe(bestBallTemplateSeats('NBA')!.starters)
    expect(shown('NHL')).toBe(bestBallTemplateSeats('NHL')!.starters)
    expect(shown('MLB')).toBe(bestBallTemplateSeats('MLB')!.starters)
    expect([shown('NBA'), shown('NHL'), shown('MLB')]).toEqual([11, 14, 23])
  })

  it("a league's own roster is what its profile and the War Room state, not the sport default", () => {
    const settings = roster({ PG: 1, SG: 1, G: 1, SF: 1, PF: 1, F: 1, C: 1, UTIL: 1, BN: 5 })
    expect(shown('NBA', settings)).toBe(8)
    const warRoom = buildRosterSettings('NBA', settings)
    expect(warRoom.startingSlots).toBe(seats('NBA', settings))
    expect(warRoom.lineupSlots.map((s) => `${s.code}x${s.count}`)).toEqual(['PGx1', 'SGx1', 'Gx1', 'SFx1', 'PFx1', 'Fx1', 'Cx1', 'UTILx1'])
  })

  it('the War Room of an NFL superflex league counts the superflex seat', () => {
    // 10 seats, where the sport default (the best_ball template) has 9 and no superflex.
    const settings = roster({ QB: 1, RB: 2, WR: 3, TE: 1, FLEX: 2, SUPERFLEX: 1, BN: 8 })
    const warRoom = buildRosterSettings('NFL', settings)
    expect(warRoom.startingSlots).toBe(10)
    expect(warRoom.lineupSlots.find((s) => s.code === 'SUPERFLEX')?.allowedPositions).toEqual(['QB', 'RB', 'WR', 'TE'])
  })
})

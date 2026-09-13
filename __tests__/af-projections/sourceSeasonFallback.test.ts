/**
 * B + C: the source-season fallback, and the carve-out that stopped masking it.
 *
 * 🛑 THE PRODUCTION FAILURE THIS PINS. On 2026-08-20 `import-players` began writing NFL 2026 roster
 * rows for a season with no games played. `sourceSeason` defaults to the NEWEST season present, so
 * it flipped 2025 -> 2026, every player refused `no_games_played`, and the cron's offseason
 * carve-out marked ten consecutive zero-write runs as SUCCESS. NFL 2025 — 1,938 complete rows that
 * had produced 1,576 projections the day before — sat unused for thirteen days, through draft season.
 *
 * The writer's own logic is exercised through an injected prisma double, so nothing here touches a
 * database. The carve-out is tested as pure logic against the same shapes.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest'

// ── prisma double ────────────────────────────────────────────────────────────────────────────
// `seasons` describes what fantasy_stat_lines holds; `linesBySeason` what each season yields.
const state: {
  seasons: number[]
  linesBySeason: Record<number, unknown[]>
  /**
   * Newest season with an UNPLAYED game, as `SportsGame` would report it. `null` is "no future
   * game found", which is also what an offseason with next year's schedule not yet loaded looks
   * like — the case where the clamp must stay out of the way.
   */
  scheduleBound: number | null
  /** Set to make the bound lookup throw, to prove the writer fails OPEN rather than stalling. */
  scheduleThrows: boolean
  /**
   * Seasons present ONLY as IDP per-game rows (`rolling_insights_pbp`). A read that excludes that
   * source cannot see them; a read that does not, can.
   */
  idpOnlySeasons: number[]
  /** Every args object the writer passed to fantasyStatLine reads, to pin the source filter. */
  statLineWheres: any[]
} = {
  seasons: [],
  linesBySeason: {},
  idpOnlySeasons: [],
  statLineWheres: [],
  scheduleBound: null,
  scheduleThrows: false,
}

vi.mock('@/lib/prisma', () => ({
  prisma: {
    fantasyStatLine: {
      findFirst: vi.fn(async (args: any) => {
        state.statLineWheres.push(args?.where)
        const lt = args?.where?.season?.lt
        const excludesIdp = args?.where?.source?.not === 'rolling_insights_pbp'
        const all = excludesIdp ? state.seasons : [...state.seasons, ...state.idpOnlySeasons]
        const pool = lt != null
          ? all.filter((s) => s < Number(lt))
          : all
        if (pool.length === 0) return null
        return { season: String(Math.max(...pool)) }
      }),
      findMany: vi.fn(async (args: any) => {
        state.statLineWheres.push(args?.where)
        const season = Number(args?.where?.season)
        const lines = (state.linesBySeason[season] ?? []) as Array<{ source?: string }>
        const excluded = args?.where?.source?.not
        return excluded ? lines.filter((l) => l.source !== excluded) : lines
      }),
    },
    playerGameStat: { findMany: vi.fn(async () => []) },
    depthChart: { findMany: vi.fn(async () => []) },
    sportsInjury: { findMany: vi.fn(async () => []) },
    playerIdentityMap: { findMany: vi.fn(async () => []) },
    aFProjectionSnapshot: { upsert: vi.fn(async () => ({})) },
    fantasyProjection: { upsert: vi.fn(async () => ({})) },
    sportsGame: {
      aggregate: vi.fn(async () => {
        if (state.scheduleThrows) throw new Error('schedule unavailable')
        return { _max: { season: state.scheduleBound } }
      }),
    },
  },
}))

/** A stat line with NO games played — the shape an unplayed season produces. */
const emptyLine = (playerId: string) => ({
  playerId,
  stats: { position: 'WR', riPlayerName: playerId, regular_season: { games_played: 0 } },
})

/** A stat line with real production, enough to clear the min-games floor. */
const playedLine = (playerId: string) => ({
  playerId,
  stats: {
    position: 'WR',
    riPlayerName: playerId,
    regular_season: { games_played: 17, DK_fantasy_points_per_game: 14.2 },
  },
})

import { writeAfProjectionSnapshots } from '@/lib/af-projections/writeAfProjectionSnapshots'
import { assess } from '@/app/api/cron/compute-projections/route'

beforeEach(() => {
  state.seasons = []
  state.linesBySeason = {}
  state.scheduleBound = null
  state.scheduleThrows = false
  state.idpOnlySeasons = []
  state.statLineWheres = []
})

describe('B — the source season rolls back when the newest was never played', () => {
  it('reproduces the NFL stall and recovers from it', async () => {
    // Exactly production on 2026-08-20: an empty 2026 alongside a complete 2025.
    state.seasons = [2025, 2026]
    state.linesBySeason[2026] = Array.from({ length: 5 }, (_, i) => emptyLine(`p${i}`))
    state.linesBySeason[2025] = Array.from({ length: 5 }, (_, i) => playedLine(`p${i}`))

    const r = await writeAfProjectionSnapshots({ sport: 'NFL' })

    expect(r.sourceSeason).toBe(2025)
    expect(r.written).toBeGreaterThan(0)
    expect(r.sourceSeasonFallback).not.toBeNull()
    expect(r.sourceSeasonFallback!.from).toBe(2026)
    expect(r.sourceSeasonFallback!.to).toBe(2025)
    // The reason must be readable by a human debugging the cron, not just a flag.
    expect(r.sourceSeasonFallback!.reason).toMatch(/no games played/i)
  })

  it('does not roll back when the newest season DID produce projections', async () => {
    state.seasons = [2025, 2026]
    state.linesBySeason[2026] = [playedLine('p1')]
    state.linesBySeason[2025] = [playedLine('p1')]

    const r = await writeAfProjectionSnapshots({ sport: 'NFL' })
    expect(r.sourceSeason).toBe(2026)
    expect(r.sourceSeasonFallback).toBeNull()
  })

  it('does not roll back when there is no older season — a real preseason', async () => {
    state.seasons = [2026]
    state.linesBySeason[2026] = [emptyLine('p1')]

    const r = await writeAfProjectionSnapshots({ sport: 'NFL' })
    expect(r.sourceSeason).toBe(2026)
    expect(r.olderSeasonAvailable).toBe(false)
    expect(r.sourceSeasonFallback).toBeNull()
  })

  it('never overrides an explicitly requested season', async () => {
    // A backfill asking for an empty season gets an honest empty answer, not another season's data.
    state.seasons = [2025, 2026]
    state.linesBySeason[2026] = [emptyLine('p1')]
    state.linesBySeason[2025] = [playedLine('p1')]

    const r = await writeAfProjectionSnapshots({ sport: 'NFL', sourceSeason: 2026 })
    expect(r.sourceSeason).toBe(2026)
    expect(r.written).toBe(0)
    expect(r.sourceSeasonFallback).toBeNull()
  })

  it('does not roll back when refusals are MIXED — that means some players did play', async () => {
    state.seasons = [2025, 2026]
    state.linesBySeason[2026] = [emptyLine('p1'), { playerId: 'p2', stats: null }]
    state.linesBySeason[2025] = [playedLine('p1')]

    const r = await writeAfProjectionSnapshots({ sport: 'NFL' })
    expect(r.sourceSeason).toBe(2026)
    expect(r.sourceSeasonFallback).toBeNull()
  })

  it('rolls back at the Thursday-to-Sunday boundary when no-game refusals dominate', async () => {
    state.seasons = [2025, 2026]
    state.linesBySeason[2026] = [
      ...Array.from({ length: 9 }, (_, i) => emptyLine(`p${i}`)),
      { playerId: 'sample-tail', stats: null },
    ]
    state.linesBySeason[2025] = Array.from({ length: 10 }, (_, i) => playedLine(`p${i}`))

    const r = await writeAfProjectionSnapshots({ sport: 'NFL' })

    expect(r.sourceSeason).toBe(2025)
    expect(r.written).toBe(10)
    expect(r.sourceSeasonFallback?.reason).toMatch(/90%.*no games played/i)
  })

  it('keeps the FIRST attempt when the rollback is also empty', async () => {
    // Reporting the older season as the source of an empty run misdescribes what happened.
    state.seasons = [2025, 2026]
    state.linesBySeason[2026] = [emptyLine('p1')]
    state.linesBySeason[2025] = [emptyLine('p1')]

    const r = await writeAfProjectionSnapshots({ sport: 'NFL' })
    expect(r.sourceSeason).toBe(2026)
    expect(r.written).toBe(0)
    expect(r.sourceSeasonFallback!.reason).toMatch(/produced nothing either/i)
  })

  it('retries ONCE, not in a loop', async () => {
    state.seasons = [2023, 2024, 2025, 2026]
    for (const s of [2023, 2024, 2025, 2026]) state.linesBySeason[s] = [emptyLine('p1')]

    const r = await writeAfProjectionSnapshots({ sport: 'NFL' })
    // Rolled back to 2025 and stopped — it did not walk down to 2023.
    expect(r.sourceSeasonFallback!.to).toBe(2025)
    expect(r.written).toBe(0)
  })
})

describe('C — the carve-out can no longer mask a stall', () => {
  /*
   * ⚠ IMPORTS THE REAL PREDICATE. The first version of this block RE-IMPLEMENTED `assess()` inline,
   * and a mutation restoring the old wide carve-out left every test green — it was checking a
   * restatement of the rule rather than the rule. A test that cannot fail when the code changes is
   * not a test. `assess` is exported from the route for exactly this reason.
   */
  const noSourceSeasonYet = (r: {
    written: number
    refused: number
    refusalsByReason: Record<string, number>
    olderSeasonAvailable: boolean
  }) => assess({ ...(r as never) }).noSourceSeasonYet

  it('🛑 REFUSES to exempt the exact production shape that hid for 13 days', () => {
    expect(noSourceSeasonYet({
      written: 0,
      refused: 1120,
      refusalsByReason: { no_games_played: 1120 },
      olderSeasonAvailable: true, // NFL 2025 existed the whole time
    })).toBe(false)
  })

  it('still exempts a genuine preseason with nothing to fall back to', () => {
    expect(noSourceSeasonYet({
      written: 0,
      refused: 1120,
      refusalsByReason: { no_games_played: 1120 },
      olderSeasonAvailable: false,
    })).toBe(true)
  })

  it('never exempts a mixed-reason refusal, with or without an older season', () => {
    for (const olderSeasonAvailable of [true, false]) {
      expect(noSourceSeasonYet({
        written: 0,
        refused: 10,
        refusalsByReason: { no_games_played: 8, insufficient_sample: 2 },
        olderSeasonAvailable,
      })).toBe(false)
    }
  })

  it('never exempts NCAAF\'s shape — insufficient_sample is a different fault', () => {
    expect(noSourceSeasonYet({
      written: 0,
      refused: 3832,
      refusalsByReason: { insufficient_sample: 3832 },
      olderSeasonAvailable: true,
    })).toBe(false)
  })
})

/**
 * D: `sourceSeason + 1` stamped a season the sport does not play yet.
 *
 * 🛑 THE PRODUCTION FAILURE THIS PINS. `inRegularSeason` — the only thing that stops the `+1` — is
 * gated `sport === 'NFL'`, so for the other five sports the fallback always fires. Measured on prod
 * 2026-09-07: **1,712 MLB rows stamped season 2027** while MLB's 2026 season was still being
 * played, plus NCAAF's first 2027 row on 09-05. `snapshotLookupKey` contains the season, so a
 * reader asking for 2026 finds none of them.
 *
 * The clamp is a BOUND, not a season authority, because neither available authority is usable:
 * `SportsGame.season` labels winter seasons by their END year where snapshots use the START year,
 * and stat-line recency is a sync artifact (finished seasons re-sync every 30 minutes). A bound
 * needs neither to agree — it only has to be an over-estimate.
 */
describe('D — targetSeason is clamped to a season the sport actually plays', () => {
  it('pulls MLB back from 2027 to 2026 while 2026 still has unplayed games', async () => {
    state.seasons = [2026]
    state.linesBySeason[2026] = Array.from({ length: 5 }, (_, i) => playedLine(`p${i}`))
    state.scheduleBound = 2026 // 143 unplayed MLB games in 2026, as prod had

    const r = await writeAfProjectionSnapshots({ sport: 'MLB' })

    expect(r.targetSeason).toBe(2026)
    expect(r.targetSeasonClamp).toEqual({
      from: 2027,
      to: 2026,
      reason: expect.stringContaining('no MLB game is scheduled in season 2027'),
    })
  })

  it('leaves the winter sports alone — their bound is HIGHER, so the clamp cannot fire', async () => {
    // NBA/NHL/NCAAB: source 2025, fallback 2026, and SportsGame calls the 2026-27 season 2027.
    state.seasons = [2025]
    state.linesBySeason[2025] = Array.from({ length: 5 }, (_, i) => playedLine(`p${i}`))
    state.scheduleBound = 2027

    const r = await writeAfProjectionSnapshots({ sport: 'NBA' })

    expect(r.targetSeason).toBe(2026)
    expect(r.targetSeasonClamp).toBeNull()
  })

  it('does not clamp when the schedule has no future game — an unloaded offseason must not drag the target back', async () => {
    // MLB in January: 2026 is finished, 2027 is not loaded. The fallback to 2027 is CORRECT here,
    // and a plain max(season) would have pulled it back onto the completed 2026.
    state.seasons = [2026]
    state.linesBySeason[2026] = Array.from({ length: 5 }, (_, i) => playedLine(`p${i}`))
    state.scheduleBound = null

    const r = await writeAfProjectionSnapshots({ sport: 'MLB' })

    expect(r.targetSeason).toBe(2027)
    expect(r.targetSeasonClamp).toBeNull()
  })

  it('an explicit targetSeason from the caller always wins over the bound', async () => {
    state.seasons = [2026]
    state.linesBySeason[2026] = Array.from({ length: 5 }, (_, i) => playedLine(`p${i}`))
    state.scheduleBound = 2026

    const r = await writeAfProjectionSnapshots({ sport: 'MLB', targetSeason: 2030 })

    expect(r.targetSeason).toBe(2030)
    expect(r.targetSeasonClamp).toBeNull()
  })

  it('fails OPEN when the schedule cannot be read — projections still write, and the error is reported', async () => {
    state.seasons = [2026]
    state.linesBySeason[2026] = Array.from({ length: 5 }, (_, i) => playedLine(`p${i}`))
    state.scheduleThrows = true

    const r = await writeAfProjectionSnapshots({ sport: 'MLB' })

    // The pre-existing fallback ships; a bound lookup that cannot run must not stall the job.
    expect(r.targetSeason).toBe(2027)
    expect(r.targetSeasonClamp).toBeNull()
    expect(r.written).toBeGreaterThan(0)
    expect(r.errors.some((e) => e.includes('target-season bound lookup failed'))).toBe(true)
  })
})

// ── E: THE SEASON BEING PLAYED ──────────────────────────────────────────────────────────────────

/** A real season aggregate with `gp` games played. */
const linePlayed = (playerId: string, gp: number) => ({
  playerId,
  source: 'rolling_insights',
  stats: {
    position: 'WR',
    riPlayerName: playerId,
    regular_season: { games_played: gp, DK_fantasy_points_per_game: 12.5 },
  },
})

/** An IDP per-game row as `persistIdpLines` writes it: no season aggregate at all. */
const idpRow = (playerId: string) => ({
  playerId,
  source: 'rolling_insights_pbp',
  stats: { gameId: '20260829-3-28', position: 'CB', playerName: playerId, idp_solo_tackle: 2 },
})

async function upsertedSeasonRows() {
  const { prisma } = (await import('@/lib/prisma')) as any
  return (prisma.aFProjectionSnapshot.upsert as any).mock.calls
    .map((c: any[]) => c[0].create)
    .filter((d: any) => d.week === null)
}

describe('E — IDP per-game rows are not season lines', () => {
  beforeEach(async () => {
    const { prisma } = (await import('@/lib/prisma')) as any
    ;(prisma.aFProjectionSnapshot.upsert as any).mockClear()
  })

  /*
   * 🛑 THE PRODUCTION STALL, 2026-09-11 TO 09-13. `persistIdpLines` writes per-game IDP rows into
   * `fantasy_stat_lines` under `rolling_insights_pbp`. The writer read every row for the season, so
   * each of 1,197 IDP rows was parsed as a season aggregate and refused `no_games_played` — which is
   * exactly the refusal count, and 1,197 + 124 real lines is exactly the 1,321 rows read.
   */
  it('reads no IDP per-game row as a season line, anywhere', async () => {
    state.seasons = [2025, 2026]
    state.linesBySeason[2026] = [linePlayed('real', 17), idpRow('name:A.Collins'), idpRow('4362628')]
    state.linesBySeason[2025] = []

    const r = await writeAfProjectionSnapshots({ sport: 'NFL', sourceSeason: 2026 })

    expect(r.refusalsByReason.no_games_played ?? 0).toBe(0)
    expect(r.statLinesRead).toBe(1)
    expect(r.written).toBe(1)
    for (const where of state.statLineWheres) expect(where.source).toEqual({ not: 'rolling_insights_pbp' })
  })

  it('does not let a season that holds only IDP rows become the source season', async () => {
    state.seasons = [2025]
    state.idpOnlySeasons = [2026]
    state.linesBySeason[2025] = [linePlayed('p1', 17)]

    const r = await writeAfProjectionSnapshots({ sport: 'NFL' })

    expect(r.sourceSeason).toBe(2025)
    expect(r.written).toBe(1)
  })
})

describe('E — while a season is being played, a player is projected from last season until he has 3 games', () => {
  beforeEach(async () => {
    const { prisma } = (await import('@/lib/prisma')) as any
    ;(prisma.aFProjectionSnapshot.upsert as any).mockClear()
  })

  /*
   * 🛑 THE SECOND STALL THIS PREVENTS. After week 1 almost every player has ONE game, refuses
   * `insufficient_sample`, and the season-level fallback (which needs no-games refusals) never
   * fires — so the writer would have written nothing until week 2 ended, and then projected from
   * two games. The per-player basis keeps every player on a full prior season until his current
   * sample is worth using.
   */
  it('reproduces production on 2026-09-13 and writes every player', async () => {
    state.seasons = [2025, 2026]
    state.linesBySeason[2026] = [
      ...Array.from({ length: 4 }, (_, i) => linePlayed(`tnf${i}`, 1)),
      ...Array.from({ length: 30 }, (_, i) => idpRow(`idp${i}`)),
    ]
    state.linesBySeason[2025] = Array.from({ length: 10 }, (_, i) => linePlayed(`tnf${i}`, 17)).map((l, i) =>
      i < 4 ? l : { ...l, playerId: `vet${i}` },
    )

    const r = await writeAfProjectionSnapshots({ sport: 'NFL' })

    expect(r.written).toBe(10)
    expect(r.refused).toBe(0)
    expect(r.sourceSeason).toBe(2026)
    expect(r.sourceSeasonFallback).toBeNull()
    expect(r.basisSeasonCounts).toEqual({ '2025': 10 })
    expect(r.priorSeasonBasis).toMatchObject({ season: 2025, minCurrentSeasonGames: 3, players: 10 })
    const rows = await upsertedSeasonRows()
    expect(rows.every((d: any) => d.season === 2026 && d.adjustmentFactors.sourceSeason === 2025)).toBe(true)
  })

  it('🛑 the boundary is 3: two games stays on last season, three games moves to this one', async () => {
    state.seasons = [2025, 2026]
    state.linesBySeason[2026] = [linePlayed('two', 2), linePlayed('three', 3)]
    state.linesBySeason[2025] = [linePlayed('two', 17), linePlayed('three', 17)]

    const r = await writeAfProjectionSnapshots({ sport: 'NFL' })

    const rows = await upsertedSeasonRows()
    const basisOf = (id: string) => rows.find((d: any) => d.playerId === id)?.adjustmentFactors.sourceSeason
    expect(basisOf('two')).toBe(2025)
    expect(basisOf('three')).toBe(2026)
    expect(r.basisSeasonCounts).toEqual({ '2025': 1, '2026': 1 })
  })

  it('includes a player who has no line this season yet from last season', async () => {
    state.seasons = [2025, 2026]
    state.linesBySeason[2026] = [linePlayed('played', 4)]
    state.linesBySeason[2025] = [linePlayed('played', 17), linePlayed('not-yet', 17)]

    const r = await writeAfProjectionSnapshots({ sport: 'NFL' })

    const rows = await upsertedSeasonRows()
    expect(rows.map((d: any) => d.playerId).sort()).toEqual(['not-yet', 'played'])
    expect(r.written).toBe(2)
  })

  it('a rookie with no prior season is judged on this season alone', async () => {
    state.seasons = [2025, 2026]
    state.linesBySeason[2026] = [linePlayed('rookie-one', 1), linePlayed('rookie-two', 2), linePlayed('vet', 4)]
    state.linesBySeason[2025] = [linePlayed('vet', 17)]

    const r = await writeAfProjectionSnapshots({ sport: 'NFL' })

    expect(r.refusalsByReason).toEqual({ insufficient_sample: 1 })
    const rows = await upsertedSeasonRows()
    expect(rows.find((d: any) => d.playerId === 'rookie-two')?.adjustmentFactors.sourceSeason).toBe(2026)
  })

  it('never blends an explicitly requested season', async () => {
    state.seasons = [2025, 2026]
    state.linesBySeason[2026] = [linePlayed('p1', 1)]
    state.linesBySeason[2025] = [linePlayed('p1', 17), linePlayed('p2', 17)]

    const r = await writeAfProjectionSnapshots({ sport: 'NFL', sourceSeason: 2026 })

    expect(r.written).toBe(0)
    expect(r.refusalsByReason).toEqual({ insufficient_sample: 1 })
    expect(r.priorSeasonBasis).toBeNull()
  })

  it('leaves a true preseason to the season-level fallback, which is not a blend', async () => {
    // No player has a game this season, so nothing is "being played" — the existing rollback owns it.
    state.seasons = [2025, 2026]
    state.linesBySeason[2026] = Array.from({ length: 5 }, (_, i) => linePlayed(`p${i}`, 0))
    state.linesBySeason[2025] = Array.from({ length: 5 }, (_, i) => linePlayed(`p${i}`, 17))

    const r = await writeAfProjectionSnapshots({ sport: 'NFL' })

    expect(r.sourceSeason).toBe(2025)
    expect(r.sourceSeasonFallback).not.toBeNull()
    expect(r.priorSeasonBasis).toBeNull()
  })
})

describe('E — a blended player\'s weekly evidence comes from his basis season', () => {
  /*
   * A prior-season projection weighted by this season's single game would be neither one thing nor
   * the other. The double returns weekly games PER SEASON, so reading the wrong season's games
   * changes how many weeks the projection says it used.
   */
  it('uses last season\'s weeks for a player on last season\'s basis', async () => {
    const { prisma } = (await import('@/lib/prisma')) as any
    ;(prisma.aFProjectionSnapshot.upsert as any).mockClear()
    ;(prisma.playerIdentityMap.findMany as any).mockImplementation(async () => [{ id: 'p1', sleeperId: 's1' }])
    ;(prisma.playerGameStat.findMany as any).mockImplementation(async (args: any) => {
      const weeks = args?.where?.season === 2025 ? [1, 2, 3, 4, 5, 6] : [1]
      return weeks.map((w) => ({
        playerId: 's1',
        weekOrRound: w,
        opponent: 'KC',
        normalizedStatMap: { pts_ppr: 11, pts_half_ppr: 10, pts_std: 9, rec: 4, rec_yd: 60 },
      }))
    })

    state.seasons = [2025, 2026]
    state.linesBySeason[2026] = [linePlayed('p1', 1)]
    state.linesBySeason[2025] = [linePlayed('p1', 17)]

    try {
      await writeAfProjectionSnapshots({ sport: 'NFL' })
      const rows = await upsertedSeasonRows()
      const row = rows.find((d: any) => d.playerId === 'p1')
      expect(row?.adjustmentFactors.sourceSeason).toBe(2025)
      expect(row?.adjustmentFactors.weeklyWeeksUsed).toBe(6)
    } finally {
      ;(prisma.playerIdentityMap.findMany as any).mockImplementation(async () => [])
      ;(prisma.playerGameStat.findMany as any).mockImplementation(async () => [])
    }
  })
})

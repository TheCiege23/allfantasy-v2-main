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
const state: { seasons: number[]; linesBySeason: Record<number, unknown[]> } = {
  seasons: [],
  linesBySeason: {},
}

vi.mock('@/lib/prisma', () => ({
  prisma: {
    fantasyStatLine: {
      findFirst: vi.fn(async (args: any) => {
        const lt = args?.where?.season?.lt
        const pool = lt != null
          ? state.seasons.filter((s) => s < Number(lt))
          : state.seasons
        if (pool.length === 0) return null
        return { season: String(Math.max(...pool)) }
      }),
      findMany: vi.fn(async (args: any) => {
        const season = Number(args?.where?.season)
        return state.linesBySeason[season] ?? []
      }),
    },
    playerGameStat: { findMany: vi.fn(async () => []) },
    depthChart: { findMany: vi.fn(async () => []) },
    sportsInjury: { findMany: vi.fn(async () => []) },
    playerIdentityMap: { findMany: vi.fn(async () => []) },
    aFProjectionSnapshot: { upsert: vi.fn(async () => ({})) },
    fantasyProjection: { upsert: vi.fn(async () => ({})) },
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

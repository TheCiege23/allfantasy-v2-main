import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import { applyLearnedFactors, learnFactors, MIN_LEVEL_GAMES, type FactorObservation } from '@/lib/af-projections/factors/factorLearner'
import { buildFactorObservations, opponentRatios, situationOf, usageOf, type GameLine } from '@/lib/af-projections/factors/factorObservations'
import { FACTOR_TABLE_KEY, nextFactorSport, runFactorLearningTick } from '@/lib/af-projections/factors/factorLearning'
import { factorReason, liveFactorAdjustments, loadFactorTable, resetFactorTableMemo } from '@/lib/af-projections/factors/factorTables'

/**
 * AF projection factors (owner's call, 2026-11-22): measured from what actually happened, kept only when they make
 * later games' projections closer, and applied by the same situation rule they were measured with.
 */

const NOW = new Date('2026-11-22T12:00:00Z')
const DAY = 86_400_000

describe('learning a factor', () => {
  /** Games in time order: `share` of them on the second night of a back-to-back, where the player really scores `effect`× his average. */
  const games = (n: number, effect: number, share = 0.3): FactorObservation[] =>
    Array.from({ length: n }, (_, i) => {
      const b2b = i % Math.round(1 / share) === 0
      const noise = 1 + (((i * 37) % 11) - 5) / 50
      return { baseline: 20, actual: 20 * (b2b ? effect : 1) * noise, levels: { rest: b2b ? 'back_to_back' : 'normal' }, atMs: NOW.getTime() - (n - i) * DAY }
    })

  it('a real effect is measured, beats the plain average on later games, and is published', () => {
    const t = learnFactors('NBA', games(2000, 0.88), NOW)
    const b2b = t.levels.find((l) => l.factor === 'rest' && l.level === 'back_to_back')!
    expect(b2b.published).toBe(true)
    expect(b2b.multiplier).toBeCloseTo(0.88, 1)
    expect(b2b.holdout.factorMae!).toBeLessThan(b2b.holdout.plainMae!)
    expect(t.overall.improvementPct!).toBeGreaterThan(0)
  })

  it('no real effect: measured, not published, and moves nothing', () => {
    const t = learnFactors('NBA', games(2000, 1), NOW)
    expect(t.levels.find((l) => l.level === 'back_to_back')!.published).toBe(false)
    expect(applyLearnedFactors(20, { rest: 'back_to_back' }, t).value).toBe(20)
  })

  it('too few games: not published, and says how many it has', () => {
    const t = learnFactors('NBA', games(300, 0.8, 0.2), NOW)
    const l = t.levels.find((x) => x.level === 'back_to_back')!
    expect(l.games).toBeLessThan(MIN_LEVEL_GAMES)
    expect(l.published).toBe(false)
    expect(l.note).toMatch(/^not enough games yet/)
  })

  it('applied together, factors are capped at ±25%', () => {
    const table = { levels: [
      { factor: 'rest', level: 'back_to_back', multiplier: 0.8, published: true },
      { factor: 'form', level: 'cold', multiplier: 0.8, published: true },
    ] } as never
    const r = applyLearnedFactors(20, { rest: 'back_to_back', form: 'cold' }, table)
    expect(r.multiplier).toBe(0.75)
    expect(r.applied).toHaveLength(2)
  })
})

describe('the situation going into a game — one rule for learning and for live projections', () => {
  const line = (i: number, points: number, over: Partial<GameLine> = {}): GameLine => ({ playerId: 'p', gameKey: `g${i}`, atMs: NOW.getTime() - (20 - i) * 2 * DAY, team: 'LAL', opponent: 'BOS', points, usage: 30, ...over })

  it('back-to-back, hot streak, rising minutes, soft opponent, new team, returning', () => {
    const past = [...Array.from({ length: 7 }, (_, i) => line(i, 20, { team: 'PHX' })), ...[7, 8, 9].map((i) => line(i, 30, { usage: 38 }))]
    const sit = situationOf('NBA', past, { atMs: past[9]!.atMs + DAY, team: 'LAL' }, 1.15)!
    expect(sit.levels).toMatchObject({ rest: 'back_to_back', form: 'hot', usage: 'rising', opponent: 'soft', team_change: 'new_team', returning: 'playing' })
    expect(situationOf('NBA', past, { atMs: past[9]!.atMs + 20 * DAY, team: 'LAL' }, null)!.levels.returning).toBe('returning')
    expect(situationOf('NBA', past.slice(0, 4), { atMs: NOW.getTime(), team: 'LAL' }, null)).toBeNull()
  })

  it('NFL rest is a short week or a bye; MLB has no rest factor', () => {
    const past = Array.from({ length: 6 }, (_, i) => line(i, 10))
    expect(situationOf('NFL', past, { atMs: past[5]!.atMs + 4 * DAY, team: 'LAL' }, null)!.levels.rest).toBe('short_rest')
    expect(situationOf('NFL', past, { atMs: past[5]!.atMs + 13 * DAY, team: 'LAL' }, null)!.levels.rest).toBe('long_rest')
    expect(situationOf('MLB', past, { atMs: past[5]!.atMs + DAY, team: 'LAL' }, null)!.levels.rest).toBe('normal')
  })

  it('observations use only what was known before each game; two rows of one game are one game', () => {
    const lines = [
      ...Array.from({ length: 6 }, (_, i) => line(i, 10)),
      line(6, 5, { gameKey: 'g6' }), line(6, 5, { gameKey: 'g6' }),
    ]
    const obs = buildFactorObservations('NBA', lines)
    expect(obs).toHaveLength(2) // games 6 and 7 of the player; the 7th (g6) summed to 10
    expect(obs[1]!.actual).toBe(10)
    expect(obs[0]!.baseline).toBe(10)
  })

  it('playing time from each sport’s line; opponents need enough games to be rated', () => {
    expect(usageOf('NBA', { stats: { minutes: 34 } })).toBe(34)
    expect(usageOf('NHL', { stats: { time_on_ice_minutes: 19.5 } })).toBe(19.5)
    expect(usageOf('NFL', { off_snp: 55 })).toBe(55)
    expect(usageOf('MLB', { stats: { pa: 4 } })).toBeNull()
    const many = Array.from({ length: 60 }, (_, i) => ({ ...line(i, i % 2 ? 30 : 10), playerId: `p${i}`, opponent: i % 2 ? 'SOFT' : 'HARD' }))
    const r = opponentRatios(many)
    expect(r.SOFT).toBeUndefined() // 30 games each, under the 50 needed
  })
})

describe('the scheduled learning and the live read', () => {
  beforeEach(() => resetFactorTableMemo())

  it('picks a sport with no table first, then the stalest; one learned today is left alone', () => {
    const ages = new Map<string, number | null>([['NFL', NOW.getTime() - 2 * 3_600_000], ['NBA', NOW.getTime() - 30 * 3_600_000], ['NHL', null]])
    expect(nextFactorSport(ages, NOW.getTime())).toBe('NHL')
  })

  it('AF_PROJECTION_FACTORS=off learns nothing and applies nothing', async () => {
    const db = { sportsDataCache: { findMany: vi.fn(), findUnique: vi.fn(), upsert: vi.fn() }, playerGameStat: { findMany: vi.fn() } }
    expect(await runFactorLearningTick(db as never, { now: NOW, env: { AF_PROJECTION_FACTORS: 'off' } as never })).toEqual({ status: 'off' })
    expect(await loadFactorTable(db as never, 'NBA', NOW, { AF_PROJECTION_FACTORS: 'off' } as never)).toBeNull()
    expect(db.sportsDataCache.findMany).not.toHaveBeenCalled()
  })

  it('a tick learns the stalest sport and stores its table with the opponents’ state', async () => {
    const upsert = vi.fn(async (_: unknown) => ({}))
    const db = {
      sportsDataCache: { findMany: vi.fn(async () => []), upsert },
      playerGameStat: { findMany: vi.fn(async () => []) },
    }
    const r = await runFactorLearningTick(db as never, { now: NOW, env: {} as never })
    expect(r).toMatchObject({ status: 'learned', sport: 'NFL', observations: 0 })
    const arg = upsert.mock.calls[0]![0] as { where: { cacheKey: string }; create: { data: { opponentRatios: unknown } } }
    expect(arg.where.cacheKey).toBe(FACTOR_TABLE_KEY('NFL'))
    expect(arg.create.data.opponentRatios).toEqual({})
  })

  it('live: a stale table is ignored; a fresh one moves only players whose situation has a published factor', async () => {
    const levels = [{ factor: 'form', level: 'hot', multiplier: 1.08, games: 900, published: true, holdout: { games: 200, plainMae: 5, factorMae: 4.8 }, note: '' }]
    const fresh = { sport: 'NBA', generatedAt: NOW.toISOString(), observations: 9000, overall: {}, levels, opponentRatios: {} }
    const old = { ...fresh, generatedAt: new Date(NOW.getTime() - 30 * DAY).toISOString() }
    expect(await loadFactorTable({ sportsDataCache: { findUnique: async () => ({ data: old }) } } as never, 'NBA', NOW, {} as never)).toBeNull()
    resetFactorTableMemo()
    const table = await loadFactorTable({ sportsDataCache: { findUnique: async () => ({ data: fresh }) } } as never, 'NBA', NOW, {} as never)
    const row = (i: number, pts: number) => ({ playerId: 'hot1', gameId: `g${i}`, providerGameId: null, gameDate: new Date(NOW.getTime() - (12 - i) * 2 * DAY), season: 2026, weekOrRound: 1, team: 'LAL', fantasyPoints: pts, normalizedStatMap: {} })
    const rows = [...Array.from({ length: 7 }, (_, i) => row(i, 20)), ...[7, 8, 9].map((i) => row(i, 32))]
    const db = { playerGameStat: { findMany: async () => rows } }
    const out = await liveFactorAdjustments(db as never, { sport: 'NBA', table, now: NOW, players: [{ key: 'k1', gameLogId: 'hot1', next: { atMs: NOW.getTime() } }, { key: 'k2', gameLogId: 'nobody', next: { atMs: NOW.getTime() } }] })
    expect(out.get('k1')).toMatchObject({ multiplier: 1.08, levels: { form: 'hot' } })
    expect(out.get('k1')!.reasons).toEqual(['hot over his last 3 games +8% (measured on 900 games)'])
    expect(out.has('k2')).toBe(false)
    expect(factorReason({ factor: 'rest', level: 'back_to_back', multiplier: 0.9, games: 1200 } as never)).toBe('second game of a back-to-back -10% (measured on 1,200 games)')
  })
})

describe('the game itself: Vegas, weather, coaching (2026-11-22)', () => {
  it('reads each level only from what was stored, and leaves a missing read as no level', async () => {
    const { vegasLevel, weatherLevel, coachingLevels } = await import('@/lib/af-projections/factors/gameContext')
    expect(vegasLevel(27, 22.5)).toBe('high')
    expect(vegasLevel(18, 22.5)).toBe('low')
    expect(vegasLevel(23, 22.5)).toBe('average')
    expect(vegasLevel(null, 22.5)).toBeUndefined()
    expect(weatherLevel({ windSpeedMph: 18, precipChancePct: 10 })).toBe('bad')
    expect(weatherLevel({ windSpeedMph: 5, precipChancePct: 70 })).toBe('bad')
    expect(weatherLevel({ isDome: true, windSpeedMph: 30 })).toBe('dome')
    expect(weatherLevel({ windSpeedMph: 5, precipChancePct: 10 })).toBe('normal')
    expect(weatherLevel({})).toBeUndefined()
    const stints = [
      { teamId: 'CHI', season: 2025, coachId: 'a' }, { teamId: 'CHI', season: 2026, coachId: 'b' },
      { teamId: 'KC', season: 2025, coachId: 'r' }, { teamId: 'KC', season: 2026, coachId: 'r' },
      // A mid-season change: two head coaches in one season — no level, the week is unknown.
      { teamId: 'NYG', season: 2025, coachId: 'x' }, { teamId: 'NYG', season: 2026, coachId: 'x' }, { teamId: 'NYG', season: 2026, coachId: 'y' },
    ]
    const lv = coachingLevels(stints, 2026)
    expect(lv.get('CHI')).toBe('new_coach')
    expect(lv.get('KC')).toBe('same_coach')
    expect(lv.has('NYG')).toBe(false)
  })

  it('a game context level reaches the situation, and a learned Vegas effect is measured like any other (positive control)', async () => {
    const { situationOf } = await import('@/lib/af-projections/factors/factorObservations')
    const past = Array.from({ length: 6 }, (_, i) => ({ atMs: i * 7 * 86_400_000, team: 'KC', points: 10, usage: null }))
    const sit = situationOf('NFL', past, { atMs: 6 * 7 * 86_400_000, team: 'KC', context: { vegas: 'high', weather: 'bad' } }, null)
    expect(sit?.levels).toMatchObject({ vegas: 'high', weather: 'bad' })
    const plain = situationOf('NFL', past, { atMs: 6 * 7 * 86_400_000, team: 'KC' }, null)
    expect(plain?.levels.vegas).toBeUndefined()

    const { learnFactors } = await import('@/lib/af-projections/factors/factorLearner')
    const obs = Array.from({ length: 1200 }, (_, i) => {
      const high = i % 3 === 0
      return { baseline: 10, actual: high ? 12 + (i % 5) * 0.1 : 10 + (i % 5) * 0.1, levels: { vegas: high ? 'high' : 'average' }, atMs: i * 3_600_000 }
    })
    const t = learnFactors('NFL', obs, new Date(1200 * 3_600_000))
    const row = t.levels.find((l) => l.factor === 'vegas' && l.level === 'high')!
    expect(row.published).toBe(true)
    expect(row.multiplier).toBeGreaterThan(1.1)
  })
})

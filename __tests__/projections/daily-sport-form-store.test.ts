/**
 * The form-line store: the writer reads the newest season's game lines in pages and writes one blob plus
 * a pointer; the reader follows the pointer and refuses an expired row.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import {
  clearDailySportFormMemo,
  dailyFormKey,
  dailyFormPointerKey,
  readDailySportForm,
  readPriorDailySportForm,
  writeDailySportFormCache,
} from '@/lib/projections/dailySportFormStore'

const line = (id: string, playerId: string, day: string, points: number, season = 2026) => ({
  id,
  playerId,
  gameId: `g-${id}`,
  providerGameId: `g-${id}`,
  gameDate: new Date(`${day}T00:00:00Z`),
  season,
  team: 'DEN',
  normalizedStatMap: { seasonType: 'regular', group: 'all', stats: { points } },
})

function makeDb(rows: ReturnType<typeof line>[]) {
  const cache = new Map<string, { data: unknown; expiresAt: Date }>()
  const findMany = vi.fn(async (args: { where: { season: number }; take: number; cursor?: { id: string } }) => {
    const ofSeason = rows.filter((r) => r.season === args.where.season)
    const start = args.cursor ? ofSeason.findIndex((r) => r.id === args.cursor!.id) + 1 : 0
    return ofSeason.slice(start, start + args.take)
  })
  return {
    cache,
    findMany,
    db: {
      playerGameStat: { findFirst: vi.fn(async () => (rows.length ? { season: Math.max(...rows.map((r) => r.season)) } : null)), findMany },
      playerIdentityMap: { findMany: vi.fn(async () => [{ id: 'p1', position: 'C' }]) },
      sportsDataCache: {
        upsert: vi.fn(async (a: { where: { cacheKey: string }; create: { data: unknown; expiresAt: Date } }) => {
          cache.set(a.where.cacheKey, { data: a.create.data, expiresAt: a.create.expiresAt })
        }),
        findUnique: vi.fn(async (a: { where: { cacheKey: string } }) => cache.get(a.where.cacheKey) ?? null),
      },
    } as never,
  }
}

beforeEach(() => clearDailySportFormMemo())

describe('writeDailySportFormCache / readDailySportForm', () => {
  it('writes the blob and its pointer, and the reader returns it', async () => {
    const t = makeDb([line('1', 'p1', '2026-10-21', 20), line('2', 'p1', '2026-10-23', 10)])
    const now = new Date('2026-10-25T07:00:00Z')
    const r = await writeDailySportFormCache(t.db, 'NBA', { now })
    expect(r).toMatchObject({ sport: 'NBA', season: 2026, rowsRead: 2, players: 1, written: true })
    // No 2025 rows: nothing is written for last season, and the run says so.
    expect(r.prior).toEqual({ season: 2025, players: 0, written: false, reason: 'no_prior_season_game_lines' })
    expect([...t.cache.keys()].sort()).toEqual([dailyFormKey('NBA', 2026), dailyFormPointerKey('NBA')].sort())
    expect(await readPriorDailySportForm(t.db, 'NBA', 2026, now)).toBeNull()
    const blob = await readDailySportForm(t.db, 'NBA', now)
    expect(blob?.players.p1).toMatchObject({ pos: 'C', sg: 2, ss: { pts: 30 } })
  })

  it('pages through more rows than one batch holds', async () => {
    const many = Array.from({ length: 10_001 }, (_, i) => line(String(i).padStart(6, '0'), 'p1', '2026-10-21', 1))
    const t = makeDb(many)
    const r = await writeDailySportFormCache(t.db, 'NBA', { now: new Date('2026-10-25T07:00:00Z') })
    // Two pages of 2026, plus one (empty) read of 2025 for the prior-season blend.
    expect(t.findMany).toHaveBeenCalledTimes(3)
    expect(r.rowsRead).toBe(10_001)
  })

  it('an expired row is not served', async () => {
    const t = makeDb([line('1', 'p1', '2026-10-21', 20), line('2', 'p1', '2026-10-23', 10)])
    await writeDailySportFormCache(t.db, 'NBA', { now: new Date('2026-10-01T07:00:00Z') })
    expect(await readDailySportForm(t.db, 'NBA', new Date('2026-10-25T07:00:00Z'))).toBeNull()
  })

  it('writes nothing for a sport it does not cover, or when there are no lines', async () => {
    const t = makeDb([])
    expect((await writeDailySportFormCache(t.db, 'NFL')).reason).toBe('not_a_daily_form_sport')
    expect((await writeDailySportFormCache(t.db, 'NHL')).reason).toBe('no_game_lines')
    expect(t.cache.size).toBe(0)
  })

  it('keeps last season\'s lines from the same table, keyed by season, and rebuilds them at most weekly', async () => {
    const t = makeDb([
      line('1', 'p1', '2026-10-21', 20),
      line('2', 'p1', '2026-10-23', 10),
      line('a', 'p1', '2025-12-01', 30, 2025),
      line('b', 'p1', '2026-01-10', 10, 2025),
    ])
    const now = new Date('2026-10-25T07:00:00Z')
    const r = await writeDailySportFormCache(t.db, 'NBA', { now })
    expect(r.prior).toEqual({ season: 2025, players: 1, written: true })
    const prior = await readPriorDailySportForm(t.db, 'NBA', 2026, now)
    expect(prior).toMatchObject({ season: 2025, players: { p1: { sg: 2, ss: { pts: 40 } } } })

    // The next night: last season is fresh, so it is not re-read.
    const reads = t.findMany.mock.calls.length
    const again = await writeDailySportFormCache(t.db, 'NBA', { now: new Date('2026-10-26T07:00:00Z') })
    expect(again.prior).toMatchObject({ season: 2025, written: false, reason: 'fresh' })
    expect(t.findMany.mock.calls.length - reads).toBe(1)
  })
})

describe('last season from season totals, when it has no game lines', () => {
  const skater = (goals: number) => ({
    playerId: 'ri-29',
    gamesPlayed: 80,
    team: 'Montreal Canadiens',
    stats: {
      goals, assists: 0, plus_minus: 0, shots_on_goal: 0, power_play_goals: 0, power_play_assists: 0,
      short_handed_goals: 0, short_handed_assists: 0, blocks: 0, hits: 0, penalty_minutes: 0,
      faceoffs_won: 0, faceoffs_lost: 0, takeaways: 0, giveaways: 0, games_played: 80,
    },
  })
  const nhlLine = (id: string, day: string, goals: number, season: number) => ({
    ...line(id, 'p1', day, 0, season),
    team: 'MTL',
    normalizedStatMap: { seasonType: 'regular', group: 'skaters', stats: { goals } },
  })

  function nhlDb(lines: ReturnType<typeof line>[]) {
    const t = makeDb(lines)
    const seasonFindMany = vi.fn(async () => [skater(40)])
    const db = t.db as unknown as Record<string, unknown>
    db.playerSeasonStats = { findMany: seasonFindMany }
    db.playerIdentityMap = {
      findMany: vi.fn(async (a: { where: { rollingInsightsId?: unknown } }) =>
        a.where.rollingInsightsId ? [{ id: 'p1', position: 'C', rollingInsightsId: 'ri-29' }] : [{ id: 'p1', position: 'C' }],
      ),
    }
    return { ...t, seasonFindMany }
  }

  it('NHL: writes a totals blob keyed on the identity id, and the reader serves it', async () => {
    const t = nhlDb([nhlLine('1', '2026-10-21', 1, 2026)])
    const now = new Date('2026-10-25T07:00:00Z')
    const r = await writeDailySportFormCache(t.db, 'NHL', { now })
    expect(r.prior).toEqual({ season: 2025, players: 1, written: true, basis: 'season_totals' })
    expect(t.seasonFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { sport: 'NHL', season: '2025', seasonType: 'regular', source: 'rolling_insights' } }),
    )
    const prior = await readPriorDailySportForm(t.db, 'NHL', 2026, now)
    expect(prior).toMatchObject({ season: 2025, basis: 'season_totals', players: { p1: { sg: 80, ss: { g: 40, pts: 40 }, rg: 0 } } })
  })

  it('game lines win over totals when both exist, and a held totals blob is rebuilt once they appear', async () => {
    const lines = [nhlLine('1', '2026-10-21', 1, 2026)]
    const t = nhlDb(lines)
    await writeDailySportFormCache(t.db, 'NHL', { now: new Date('2026-10-25T07:00:00Z') })
    expect(t.seasonFindMany).toHaveBeenCalledTimes(1)

    // 2025 game lines land the next day: the totals blob is not "fresh" any more, and is replaced.
    lines.push(nhlLine('a', '2026-01-10', 2, 2025), nhlLine('b', '2026-01-12', 0, 2025))
    const next = new Date('2026-10-26T07:00:00Z')
    const r = await writeDailySportFormCache(t.db, 'NHL', { now: next })
    expect(r.prior).toEqual({ season: 2025, players: 1, written: true })
    expect(t.seasonFindMany).toHaveBeenCalledTimes(1)
    clearDailySportFormMemo()
    const prior = await readPriorDailySportForm(t.db, 'NHL', 2026, next)
    expect(prior?.basis).toBeUndefined()
    expect(prior?.players.p1).toMatchObject({ sg: 2, ss: { g: 2 } })
  })

  it('NBA does not qualify, so its season totals are never read', async () => {
    const t = nhlDb([line('1', 'p1', '2026-10-21', 20)])
    const r = await writeDailySportFormCache(t.db, 'NBA', { now: new Date('2026-10-25T07:00:00Z') })
    expect(r.prior).toEqual({ season: 2025, players: 0, written: false, reason: 'no_prior_season_game_lines' })
    expect(t.seasonFindMany).not.toHaveBeenCalled()
  })
})

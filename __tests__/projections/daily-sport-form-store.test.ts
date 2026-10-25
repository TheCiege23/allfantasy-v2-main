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
  writeDailySportFormCache,
} from '@/lib/projections/dailySportFormStore'

const line = (id: string, playerId: string, day: string, points: number) => ({
  id,
  playerId,
  gameId: `g-${id}`,
  providerGameId: `g-${id}`,
  gameDate: new Date(`${day}T00:00:00Z`),
  season: 2026,
  team: 'DEN',
  normalizedStatMap: { seasonType: 'regular', group: 'all', stats: { points } },
})

function makeDb(rows: ReturnType<typeof line>[]) {
  const cache = new Map<string, { data: unknown; expiresAt: Date }>()
  const findMany = vi.fn(async (args: { take: number; cursor?: { id: string } }) => {
    const start = args.cursor ? rows.findIndex((r) => r.id === args.cursor!.id) + 1 : 0
    return rows.slice(start, start + args.take)
  })
  return {
    cache,
    findMany,
    db: {
      playerGameStat: { findFirst: vi.fn(async () => (rows.length ? { season: 2026 } : null)), findMany },
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
    expect([...t.cache.keys()].sort()).toEqual([dailyFormKey('NBA', 2026), dailyFormPointerKey('NBA')].sort())
    const blob = await readDailySportForm(t.db, 'NBA', now)
    expect(blob?.players.p1).toMatchObject({ pos: 'C', sg: 2, ss: { pts: 30 } })
  })

  it('pages through more rows than one batch holds', async () => {
    const many = Array.from({ length: 10_001 }, (_, i) => line(String(i).padStart(6, '0'), 'p1', '2026-10-21', 1))
    const t = makeDb(many)
    const r = await writeDailySportFormCache(t.db, 'NBA', { now: new Date('2026-10-25T07:00:00Z') })
    expect(t.findMany).toHaveBeenCalledTimes(2)
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
})

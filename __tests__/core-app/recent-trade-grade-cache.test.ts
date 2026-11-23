import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
const { findMany, upsert } = vi.hoisted(() => ({ findMany: vi.fn(), upsert: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ prisma: { sportsDataCache: { findMany, upsert } } }))

import {
  CORE_TRADE_GRADE_FRESH_MS,
  CORE_TRADE_GRADE_STALE_MS,
  coreTradeGradeFingerprint,
  coreTradeGradeHit,
  coreTradeGradeKey,
  readCoreTradeGrades,
  writeCoreTradeGrades,
} from '@/lib/core-app/recentTradeGradeCache'
import type { GradedTrade } from '@/lib/trade-intel/sleeperTradeGradeService'

const NOW = new Date('2026-11-23T14:00:00Z')
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString()
const GRADE = { graded: false, reason: 'not priced in this test', basis: null } as const

function trade(over: Partial<GradedTrade> = {}): GradedTrade {
  const side = (rosterId: number, managerName: string) => ({
    rosterId, ownerId: null, managerName, teamName: null, avatar: null,
    playersIn: [{ playerId: String(rosterId), name: `P${rosterId}`, position: 'WR', pointsBySeason: {}, creditedBySeason: {}, departed: null, gamesMissedBySeason: {} }],
    playersOut: [],
    picksIn: [], picksOut: [],
    madePlayoffs: null, seasonNets: [{ season: '2026', net: 10, partial: true }], cumulativeNet: 10,
    initialGrade: 'B', currentGrade: 'B', trend: 'steady',
  })
  return {
    id: '1430203040543051776', season: '2026', week: 10, createdIso: '2026-11-10T12:00:00Z', multiTeam: false, tie: false,
    sides: [side(1, 'one'), side(2, 'two')], hasPendingPicks: false, ...over,
  } as GradedTrade
}

beforeEach(() => {
  findMany.mockReset()
  upsert.mockReset()
  findMany.mockResolvedValue([])
  upsert.mockResolvedValue({})
})

describe('the fingerprint: what the grade is computed from, and nothing else', () => {
  it('ignores realized points, which change weekly', () => {
    const a = trade()
    const b = trade()
    b.sides[0]!.seasonNets = [{ season: '2026', net: 99, partial: true }]
    b.sides[0]!.cumulativeNet = 99
    b.sides[0]!.currentGrade = 'A'
    expect(coreTradeGradeFingerprint(b, 2026)).toBe(coreTradeGradeFingerprint(a, 2026))
  })

  it('never throws: a trade missing fields still fingerprints, and an unreadable one is null and never a hit', () => {
    const partial = trade()
    delete (partial.sides[0] as Partial<GradedTrade['sides'][number]>).playersOut
    delete (partial.sides[0] as Partial<GradedTrade['sides'][number]>).picksOut
    expect(coreTradeGradeFingerprint(partial, 2026)).toEqual(expect.any(String))
    expect(coreTradeGradeFingerprint(null as unknown as GradedTrade, 2026)).toBeNull()
    expect(coreTradeGradeHit({ t1: { fp: 'x', at: NOW.toISOString(), grade: GRADE } }, 't1', null, NOW)).toBeNull()
  })

  it('changes with a player, a pick turning into a player, FAAB, a manager name, the season or the trade', () => {
    const base = coreTradeGradeFingerprint(trade(), 2026)
    const player = trade(); player.sides[1]!.playersIn[0]!.playerId = '999'
    const pick = (resolved: boolean) => {
      const t = trade()
      t.sides[0]!.picksIn = [{ season: '2027', round: 1, originalRosterId: 2, label: '2027 1st', pending: !resolved, rerouted: false,
        resolved: resolved ? { playerId: '77', name: 'Rookie', position: 'RB', creditedBySeason: {}, departed: null } : null }]
      return coreTradeGradeFingerprint(t, 2026)
    }
    const faab = trade(); faab.sides[0]!.faabIn = 5
    const name = trade(); name.sides[0]!.managerName = 'renamed'
    const all = [base, coreTradeGradeFingerprint(player, 2026), pick(false), pick(true), coreTradeGradeFingerprint(faab, 2026),
      coreTradeGradeFingerprint(name, 2026), coreTradeGradeFingerprint(trade(), 2027), coreTradeGradeFingerprint(trade({ id: '1' }), 2026)]
    expect(new Set(all).size).toBe(all.length)
  })
})

describe('a hit', () => {
  const entry = (at: string, fp = 'fp-1') => ({ t1: { fp, at, grade: GRADE } })

  it('is fresh inside the fresh window, stale up to the stale window, and gone past it', () => {
    expect(coreTradeGradeHit(entry(ago(CORE_TRADE_GRADE_FRESH_MS - 1)), 't1', 'fp-1', NOW)).toEqual({ grade: GRADE, stale: false })
    expect(coreTradeGradeHit(entry(ago(CORE_TRADE_GRADE_FRESH_MS + 1)), 't1', 'fp-1', NOW)).toEqual({ grade: GRADE, stale: true })
    expect(coreTradeGradeHit(entry(ago(CORE_TRADE_GRADE_STALE_MS + 1)), 't1', 'fp-1', NOW)).toBeNull()
  })

  it('needs the same fingerprint and the same trade, and refuses an entry from the future', () => {
    expect(coreTradeGradeHit(entry(ago(1000)), 't1', 'other', NOW)).toBeNull()
    expect(coreTradeGradeHit(entry(ago(1000)), 't2', 'fp-1', NOW)).toBeNull()
    expect(coreTradeGradeHit(entry(new Date(NOW.getTime() + 60_000).toISOString()), 't1', 'fp-1', NOW)).toBeNull()
    expect(coreTradeGradeHit(undefined, 't1', 'fp-1', NOW)).toBeNull()
  })
})

describe('read and write', () => {
  it('reads every league in one query, only unexpired rows, and skips a row of another shape', async () => {
    findMany.mockResolvedValue([
      { cacheKey: coreTradeGradeKey('af-1'), data: { version: 1, byTrade: { t1: { fp: 'x', at: ago(0), grade: GRADE } } } },
      { cacheKey: coreTradeGradeKey('af-2'), data: { version: 9, byTrade: {} } },
    ])
    const out = await readCoreTradeGrades(['af-1', 'af-2', 'af-1'], NOW)
    expect(findMany).toHaveBeenCalledTimes(1)
    expect(findMany.mock.calls[0]![0].where).toEqual({ cacheKey: { in: [coreTradeGradeKey('af-1'), coreTradeGradeKey('af-2')] }, expiresAt: { gt: NOW } })
    expect([...out.keys()]).toEqual(['af-1'])
  })

  it('a failed read is an empty map; a failed write is dropped', async () => {
    findMany.mockRejectedValue(new Error('db down'))
    expect((await readCoreTradeGrades(['af-1'], NOW)).size).toBe(0)
    upsert.mockRejectedValue(new Error('db down'))
    await expect(writeCoreTradeGrades('af-1', undefined, new Map([['t1', { fp: 'x', at: ago(0), grade: GRADE }]]), NOW)).resolves.toBeUndefined()
  })

  it('merges new grades into the league entry, drops entries past the stale window, and expires the row with it', async () => {
    const previous = {
      kept: { fp: 'k', at: ago(60_000), grade: GRADE },
      old: { fp: 'o', at: ago(CORE_TRADE_GRADE_STALE_MS + 1), grade: GRADE },
      replaced: { fp: 'r', at: ago(60_000), grade: GRADE },
    }
    await writeCoreTradeGrades('af-1', previous, new Map([['replaced', { fp: 'r2', at: ago(0), grade: GRADE }], ['new', { fp: 'n', at: ago(0), grade: GRADE }]]), NOW)
    const call = upsert.mock.calls[0]![0]
    expect(call.where).toEqual({ cacheKey: coreTradeGradeKey('af-1') })
    expect(Object.keys(call.create.data.byTrade).sort()).toEqual(['kept', 'new', 'replaced'])
    expect(call.create.data.byTrade.replaced.fp).toBe('r2')
    expect(call.update.expiresAt).toEqual(new Date(NOW.getTime() + CORE_TRADE_GRADE_STALE_MS))
  })
})

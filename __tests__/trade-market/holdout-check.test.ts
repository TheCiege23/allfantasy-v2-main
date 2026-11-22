import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  backtestGathered,
  booksNotHeld,
  describeHoldout,
  HOLDOUT_CACHE_KEY,
  HOLDOUT_MIN_TEST_TRADES,
  holdoutRowOf,
  holdoutRowsOf,
  learnedMarketHolds,
  runHoldoutCheck,
  type HoldoutRow,
} from '@/lib/trade-market/holdoutCheck'
import { backtestPosture } from '@/lib/trade-market/learnedMarketBacktest'
import { loadLearnedTables, learnedPostureAdjustment, resetLearnedTablesMemo, withoutNotHeld, type LearnedTables } from '@/lib/trade-market/learnedInGrades'
import { NEED_MARKET_CACHE_KEY, PICK_MARKET_CACHE_KEY, POSTURE_MARKET_CACHE_KEY } from '@/lib/trade-market/formatMarkets'
import { resetTradeMarketReleaseMemo, tradeMarketPanelReleased } from '@/lib/partner-portal/tradeMarketRelease'

/**
 * A learned number that does not hold on later trades turns itself off (owner's call, 2026-11-22). The daily job stores
 * a verdict per learner and book; only a stored `not_held` ever removes anything from a grade.
 */

const NOW = new Date('2026-11-22T12:00:00Z')
const CUTOFF = new Date('2025-09-01T00:00:00Z')
const BOOK = 'DYNASTY:SUPERFLEX'
const before = (i: number) => new Date(CUTOFF.getTime() - (i + 1) * 86_400_000)
const after = (i: number) => new Date(CUTOFF.getTime() + i * 86_400_000)
const wobble = (i: number) => 1 + ((i % 5) - 2) / 100
const posture = (buyer: 'contend' | 'middle', ratio: number, n: number, at: (i: number) => Date, tag: string) =>
  Array.from({ length: n }, (_, i) => ({ obs: { transactionId: `${tag}${i}`, buyer, bought: 'veteran' as const, ratio: ratio * wobble(i), weight: 1 }, tradeDate: at(i) }))

const real = (laterN = 40) => backtestPosture(BOOK, [...posture('contend', 1.1, 40, before, 'a'), ...posture('middle', 1, 40, before, 'b'), ...posture('contend', 1.1, laterN, after, 'c')], CUTOFF)
const noise = () => backtestPosture(BOOK, [...posture('contend', 1.12, 40, before, 'a'), ...posture('middle', 1, 40, before, 'b'), ...posture('contend', 0.9, 40, after, 'c'), ...posture('middle', 1, 40, after, 'd')], CUTOFF)

const row = (over: Partial<HoldoutRow>): HoldoutRow => ({ learner: 'posture', book: BOOK, verdict: 'held', improvementPct: 40, trainTrades: 80, testTrades: 40, publishedRows: 1, flippedRows: 0, ...over })
const doc = (rows: HoldoutRow[], generatedAt = '2026-11-22T06:00:00Z') => ({ generatedAt, cutoff: CUTOFF.toISOString(), sinceSeason: 2020, rows })

describe('the verdict', () => {
  it('a real premium holds; a number that reversed does not', () => {
    expect(holdoutRowOf(real())).toMatchObject({ learner: 'posture', book: BOOK, verdict: 'held', publishedRows: 1, flippedRows: 0, testTrades: 40 })
    expect(holdoutRowOf(noise())).toMatchObject({ verdict: 'not_held', flippedRows: 1 })
    expect(holdoutRowOf(noise()).improvementPct!).toBeLessThan(0)
  })

  it('too few later trades is "unknown" either way — never a verdict on a handful', () => {
    expect(holdoutRowOf(real(HOLDOUT_MIN_TEST_TRADES - 1)).verdict).toBe('unknown')
    expect(holdoutRowOf(real(HOLDOUT_MIN_TEST_TRADES)).verdict).toBe('held')
  })

  it('nothing published earlier is "unknown", and says so', () => {
    const b = backtestPosture(BOOK, [...posture('contend', 1.1, 5, before, 'a'), ...posture('middle', 1, 40, before, 'b'), ...posture('contend', 1.1, 40, after, 'c')], CUTOFF)
    const r = holdoutRowOf(b)
    expect(r.verdict).toBe('unknown')
    expect(describeHoldout(r)).toBe('Not checked: nothing was published from the earlier trades.')
  })

  it('reads in plain words', () => {
    expect(describeHoldout(row({ improvementPct: 42.5 }))).toBe('Held: the learned grade was 42.5% closer to what later trades cost (40 later trades).')
    expect(describeHoldout(row({ verdict: 'not_held', improvementPct: -18 }))).toBe('Did not hold: the learned grade was 18% further from what later trades cost (40 later trades) — grades ignore it for this book.')
    expect(describeHoldout(row({ verdict: 'unknown', testTrades: 12 }))).toBe('Not enough later trades to tell yet (12 later trades; needs 30).')
  })
})

describe('reading the stored verdicts', () => {
  it('absent, unreadable or older than 21 days = no rows, which gates nothing', () => {
    expect(holdoutRowsOf(null, NOW)).toEqual([])
    expect(holdoutRowsOf({ generatedAt: 'x', rows: [row({})] }, NOW)).toEqual([])
    expect(holdoutRowsOf(doc([row({})], '2026-10-25T00:00:00Z'), NOW)).toEqual([])
    expect(holdoutRowsOf(doc([row({})]), NOW)).toHaveLength(1)
  })

  it('only a stored not_held names a book to drop, per learner', () => {
    const rows = [row({ verdict: 'not_held' }), row({ learner: 'need', verdict: 'unknown' }), row({ learner: 'picks', verdict: 'held' }), row({ book: 'DYNASTY:ONE_QB', verdict: 'not_held' })]
    expect([...booksNotHeld(rows, 'posture')].sort()).toEqual(['DYNASTY:ONE_QB', BOOK])
    expect(booksNotHeld(rows, 'need').size).toBe(0)
    expect(booksNotHeld(rows, 'picks').size).toBe(0)
  })

  it('release to partners: at least one held, and more held than failed', () => {
    expect(learnedMarketHolds([])).toBe(false)
    expect(learnedMarketHolds([row({ verdict: 'unknown' })])).toBe(false)
    expect(learnedMarketHolds([row({})])).toBe(true)
    expect(learnedMarketHolds([row({}), row({ verdict: 'not_held' })])).toBe(false)
    expect(learnedMarketHolds([row({}), row({}), row({ verdict: 'not_held' })])).toBe(true)
  })
})

describe('the grades', () => {
  const tables = (): LearnedTables => ({
    picks: new Map([[BOOK, []]]),
    need: new Map([[BOOK, []]]),
    posture: new Map([
      [BOOK, [{ buyer: 'contend', bought: 'veteran', published: true, premiumPct: 8, trades: 210 }]],
      ['DYNASTY:ONE_QB', [{ buyer: 'contend', bought: 'veteran', published: true, premiumPct: 5, trades: 90 }]],
    ]),
  })

  it('a not_held learner is dropped for that book only; the other book and the other learners are untouched', () => {
    const t = withoutNotHeld(tables(), doc([row({ verdict: 'not_held' })]), NOW)
    expect(learnedPostureAdjustment(t, BOOK, 'contend', 'veteran')).toBeNull()
    expect(learnedPostureAdjustment(t, 'DYNASTY:ONE_QB', 'contend', 'veteran')?.factor).toBeCloseTo(1.05)
    expect(t.picks.has(BOOK)).toBe(true)
    expect(t.need.has(BOOK)).toBe(true)
  })

  it('held, unknown, a stale verdict or none at all change nothing', () => {
    for (const d of [doc([row({})]), doc([row({ verdict: 'unknown' })]), doc([row({ verdict: 'not_held' })], '2026-10-25T00:00:00Z'), null]) {
      const t = withoutNotHeld(tables(), d, NOW)
      expect(learnedPostureAdjustment(t, BOOK, 'contend', 'veteran')?.factor).toBeCloseTo(1.08)
    }
  })

  it('loadLearnedTables applies the stored verdict', async () => {
    const store: Record<string, unknown> = {
      [PICK_MARKET_CACHE_KEY]: null,
      [NEED_MARKET_CACHE_KEY]: null,
      [POSTURE_MARKET_CACHE_KEY]: { generatedAt: '2026-11-22T06:00:00Z', books: [{ book: BOOK, premiums: [{ buyer: 'contend', bought: 'veteran', published: true, premiumPct: 8, trades: 210 }] }] },
      [HOLDOUT_CACHE_KEY]: doc([row({ verdict: 'not_held' })]),
    }
    const prisma = { sportsDataCache: { findUnique: async ({ where }: { where: { cacheKey: string } }) => (store[where.cacheKey] ? { data: store[where.cacheKey] } : null) } }
    resetLearnedTablesMemo()
    expect(learnedPostureAdjustment(await loadLearnedTables(prisma, NOW), BOOK, 'contend', 'veteran')).toBeNull()
    store[HOLDOUT_CACHE_KEY] = doc([row({})])
    resetLearnedTablesMemo()
    expect(learnedPostureAdjustment(await loadLearnedTables(prisma, NOW), BOOK, 'contend', 'veteran')?.factor).toBeCloseTo(1.08)
    resetLearnedTablesMemo()
  })
})

describe('the daily run', () => {
  const gathered = (laterRatio: number) => {
    const all = [...posture('contend', 1.1, 40, before, 'a'), ...posture('middle', 1, 40, before, 'b'), ...posture('contend', laterRatio, 40, after, 'c')]
    const dates = new Map(all.map((d) => [d.obs.transactionId, d.tradeDate]))
    const g = { byBookPicks: new Map(), byBookNeed: new Map(), byBookPosture: new Map([[BOOK, { observations: all.map((d) => d.obs), skipped: {} }]]) }
    const upsert = vi.fn(async (_: unknown) => ({}))
    const prisma = {
      leagueTrade: { findMany: async (args: unknown) => (args as { where: { transactionId: { in: string[] } } }).where.transactionId.in.map((id) => ({ transactionId: id, tradeDate: dates.get(id) ?? null })) },
      sportsDataCache: { upsert },
    }
    return { g, prisma, upsert }
  }

  it('stores one verdict per learner and book, for 21 days', async () => {
    const { g, prisma, upsert } = gathered(1.1)
    const out = await runHoldoutCheck(prisma, { now: NOW, sinceSeason: 2020, env: {} as NodeJS.ProcessEnv, gather: (async () => g) as never })
    expect(out!.rows).toHaveLength(1)
    expect(out!.rows[0]).toMatchObject({ learner: 'posture', book: BOOK, verdict: 'held' })
    const arg = upsert.mock.calls[0]![0] as { where: { cacheKey: string }; create: { expiresAt: Date; data: unknown } }
    expect(arg.where.cacheKey).toBe(HOLDOUT_CACHE_KEY)
    expect(arg.create.expiresAt.getTime() - NOW.getTime()).toBe(21 * 86_400_000)
    expect(holdoutRowsOf(arg.create.data, NOW)).toHaveLength(1)
  })

  it('a number that reversed is stored as not_held', async () => {
    const { g, prisma } = gathered(0.9)
    const out = await runHoldoutCheck(prisma, { now: NOW, sinceSeason: 2020, env: {} as NodeJS.ProcessEnv, gather: (async () => g) as never })
    expect(out!.rows[0]!.verdict).toBe('not_held')
  })

  it('TRADE_HOLDOUT_CHECK=off computes and stores nothing', async () => {
    const { g, prisma, upsert } = gathered(1.1)
    const gather = vi.fn(async () => g)
    expect(await runHoldoutCheck(prisma, { now: NOW, sinceSeason: 2020, env: { TRADE_HOLDOUT_CHECK: 'off' } as never, gather: gather as never })).toBeNull()
    expect(gather).not.toHaveBeenCalled()
    expect(upsert).not.toHaveBeenCalled()
  })

  it('trades with no date are left out; with nothing dated there is no verdict and nothing stored', async () => {
    const { g, upsert } = gathered(1.1)
    const prisma = { leagueTrade: { findMany: async () => [] }, sportsDataCache: { upsert } }
    expect(await backtestGathered(prisma, g as never)).toBeNull()
    expect(await runHoldoutCheck(prisma, { now: NOW, sinceSeason: 2020, env: {} as NodeJS.ProcessEnv, gather: (async () => g) as never })).toBeNull()
    expect(upsert).not.toHaveBeenCalled()
  })
})

describe('the partner panel', () => {
  beforeEach(() => resetTradeMarketReleaseMemo())
  const prismaWith = (data: unknown) => ({ sportsDataCache: { findUnique: vi.fn(async () => (data ? { data } : null)) } })
  const env = (v?: string) => (v ? { PARTNER_TRADE_MARKET_PANEL: v } : {}) as NodeJS.ProcessEnv

  it('hidden until the numbers hold, then shown', async () => {
    expect(await tradeMarketPanelReleased(prismaWith(null), env(), NOW)).toBe(false)
    resetTradeMarketReleaseMemo()
    expect(await tradeMarketPanelReleased(prismaWith(doc([row({ verdict: 'not_held' })])), env(), NOW)).toBe(false)
    resetTradeMarketReleaseMemo()
    expect(await tradeMarketPanelReleased(prismaWith(doc([row({})])), env(), NOW)).toBe(true)
  })

  it('a store that throws hides it; the owner override wins either way without a read', async () => {
    const broken = { sportsDataCache: { findUnique: vi.fn(async () => { throw new Error('down') }) } }
    expect(await tradeMarketPanelReleased(broken, env(), NOW)).toBe(false)
    resetTradeMarketReleaseMemo()
    const held = prismaWith(doc([row({})]))
    expect(await tradeMarketPanelReleased(held, env('off'), NOW)).toBe(false)
    expect(await tradeMarketPanelReleased(prismaWith(null), env('on'), NOW)).toBe(true)
    expect(held.sportsDataCache.findUnique).not.toHaveBeenCalled()
  })
})

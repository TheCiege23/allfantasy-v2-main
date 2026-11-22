import { describe, expect, it } from 'vitest'

import { loadLearnedMarketReport, summarizeLearnedMarket } from '@/lib/trade-market/learnedMarketReport'
import { NEED_MARKET_CACHE_KEY, PICK_MARKET_CACHE_KEY, POSTURE_MARKET_CACHE_KEY } from '@/lib/trade-market/formatMarkets'

/**
 * /admin/trade-market (owner's call, 2026-11-22): what each learner measured, the evidence behind it, whether it is
 * published, and the exact line a grade prints — produced by the grader's own functions, so the page cannot promise a
 * grade the grader would not give.
 */

const NOW = new Date('2026-11-22T12:00:00Z')
const BOOK = 'DYNASTY:SUPERFLEX'

const pickDoc = (generatedAt = '2026-11-22T06:00:00Z', over: Record<string, unknown> = {}) => ({
  generatedAt,
  books: [{
    book: BOOK, tradesUsed: 900, roundsOrdered: true, horizonsOrdered: true, ...over,
    classes: [
      { key: '1:0', round: 1, horizon: 0, prior: 4000, learned: 4600, ratio: 1.15, effectiveSample: 61.2, trades: 88, published: true, value: 4600, note: 'measured' },
      { key: '2:1', round: 2, horizon: 1, prior: 2000, learned: 2600, ratio: 1.3, effectiveSample: 9, trades: 9, published: false, value: 2000, note: 'not enough trades yet (9 of 30)' },
    ],
  }],
})
const postureDoc = {
  generatedAt: '2026-11-22T06:00:00Z',
  books: [{ book: BOOK, observations: 400, premiums: [
    { buyer: 'contend', bought: 'veteran', premiumPct: 8, effectiveSample: 50, baselineEffectiveSample: 120, trades: 210, published: true, note: 'measured' },
    { buyer: 'rebuild', bought: 'youth', premiumPct: 9, effectiveSample: 8, baselineEffectiveSample: 120, trades: 20, published: false, note: 'not enough' },
  ] }],
}
const needDoc = {
  generatedAt: '2026-11-22T06:00:00Z',
  books: [{ book: BOOK, observations: 300, premiums: [
    { position: 'TE', need: 'short', premiumPct: 11, effectiveSample: 40, baselineEffectiveSample: 90, trades: 140, published: true, note: 'measured' },
    { position: 'TE', need: 'short_this_week', premiumPct: 14, effectiveSample: 30, baselineEffectiveSample: 90, trades: 60, published: true, note: 'measured' },
  ] }],
}

describe('the learned market report', () => {
  it('each measured number with its evidence, status and the line a grade prints', () => {
    const r = summarizeLearnedMarket({ picks: pickDoc(), posture: postureDoc, need: needDoc }, { TRADE_LEARNED_PICKS: 'on' }, NOW)
    expect(r.totalRows).toBe(6)
    expect(r.publishedRows).toBe(4)
    const [picks, posture, need] = r.sections
    expect(picks!.switch).toMatchObject({ env: 'TRADE_LEARNED_PICKS', on: true })
    expect(posture!.switch.on).toBe(false)
    const first = picks!.books[0]!
    expect(first.label).toBe('Dynasty · Superflex')
    expect(first.rows[0]).toMatchObject({ label: '1st · Next draft', pct: 15, trades: 88, published: true })
    expect(first.rows[0]!.gradeSays).toMatch(/AllFantasy pick market \+15%.*88 completed trades/)
    // Unpublished: measured and shown, never printed on a grade.
    expect(first.rows[1]).toMatchObject({ pct: 30, published: false, gradeSays: null })
    expect(posture!.books[0]!.rows[0]!.gradeSays).toMatch(/teams at \.600 or better paid \+8% for players 27 or older/)
    expect(posture!.books[0]!.rows[1]!.gradeSays).toBeNull()
    expect(need!.books[0]!.rows[0]!.gradeSays).toMatch(/teams short at TE paid \+11%.*140 completed trades/)
    // "Short this week" is measured and published but no grade applies it yet: the page must not say it does.
    expect(need!.books[0]!.rows[1]).toMatchObject({ published: true, gradeSays: null })
  })

  it('a stale table is flagged, and its published rows print nothing — as the grades ignore them', () => {
    const r = summarizeLearnedMarket({ picks: pickDoc('2026-10-01T00:00:00Z'), posture: null, need: null }, {}, NOW)
    const picks = r.sections[0]!
    expect(picks.status).toMatchObject({ stale: true, missing: false })
    expect(picks.books[0]!.rows[0]).toMatchObject({ published: true, gradeSays: null })
    expect(r.sections[1]!.status.missing).toBe(true)
    expect(r.sections[1]!.books).toEqual([])
  })

  it('rounds or drafts out of order are called out', () => {
    const r = summarizeLearnedMarket({ picks: pickDoc(undefined, { roundsOrdered: false }), posture: null, need: null }, {}, NOW)
    expect(r.sections[0]!.books[0]!.warnings).toHaveLength(1)
  })

  it('reads the three stored tables fresh on every load', async () => {
    const asked: string[] = []
    const prisma = {
      sportsDataCache: {
        findUnique: async ({ where }: { where: { cacheKey: string } }) => {
          asked.push(where.cacheKey)
          return where.cacheKey === PICK_MARKET_CACHE_KEY ? { data: pickDoc() } : null
        },
      },
    }
    const a = await loadLearnedMarketReport(prisma, {}, NOW)
    await loadLearnedMarketReport(prisma, {}, NOW)
    expect(asked.sort()).toEqual([NEED_MARKET_CACHE_KEY, NEED_MARKET_CACHE_KEY, PICK_MARKET_CACHE_KEY, PICK_MARKET_CACHE_KEY, POSTURE_MARKET_CACHE_KEY, POSTURE_MARKET_CACHE_KEY].sort())
    expect(a.totalRows).toBe(2)
  })
})

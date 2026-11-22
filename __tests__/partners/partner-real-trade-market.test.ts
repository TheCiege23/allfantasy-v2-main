import { describe, expect, it } from 'vitest'

import { summarizeLearnedMarket } from '@/lib/trade-market/learnedMarketReport'
import { MAX_PER_GROUP, realTradeMarketRows } from '@/lib/partner-portal/realTradeMarket'

/** The partner panel on the real learned market (owner's call, 2026-11-22), sample data only as a fallback. */

const NOW = new Date('2026-11-22T12:00:00Z')
const at = '2026-11-22T06:00:00Z'
const cls = (key: string, round: number, horizon: number, prior: number, learned: number, trades: number, published: boolean) =>
  ({ key, round, horizon, prior, learned, ratio: learned / prior, effectiveSample: trades, trades, published, value: learned, note: published ? 'measured' : `not enough trades yet (${trades} of 30)` })
const raw = {
  picks: { generatedAt: at, books: [
    { book: 'REDRAFT:ONE_QB', tradesUsed: 10, classes: [cls('1:0', 1, 0, 1000, 1000, 5, false)] },
    { book: 'DYNASTY:SUPERFLEX', tradesUsed: 900, classes: [cls('1:0', 1, 0, 4000, 4600, 388, true), cls('2:0', 2, 0, 2000, 2560, 301, true), cls('1:2', 1, 2, 3000, 2730, 164, true), cls('3:2', 3, 2, 500, 640, 12, false)] },
  ] },
  posture: { generatedAt: at, books: [{ book: 'DYNASTY:SUPERFLEX', observations: 400, premiums: [
    { buyer: 'contend', bought: 'veteran', premiumPct: 8.2, effectiveSample: 50, baselineEffectiveSample: 120, trades: 210, published: true, note: 'measured' },
    { buyer: 'rebuild', bought: 'youth', premiumPct: 9, effectiveSample: 8, baselineEffectiveSample: 120, trades: 12, published: false, note: 'not enough trades: 8 rebuild and 120 middle (need 20 each)' },
  ] }] },
  need: { generatedAt: at, books: [{ book: 'DYNASTY:SUPERFLEX', observations: 300, premiums: [
    { position: 'TE', need: 'short', premiumPct: 11, effectiveSample: 40, baselineEffectiveSample: 90, trades: 140, published: true, note: 'measured' },
    { position: 'TE', need: 'short_this_week', premiumPct: 14, effectiveSample: 30, baselineEffectiveSample: 90, trades: 60, published: true, note: 'measured' },
    { position: 'QB', need: 'deep', premiumPct: -4, effectiveSample: 70, baselineEffectiveSample: 90, trades: 150, published: true, note: 'measured' },
  ] }] },
}

describe('realTradeMarketRows', () => {
  it('the most-published book per group, published first, at most three rows, in the panel’s words', () => {
    const rows = realTradeMarketRows(summarizeLearnedMarket(raw, {} as NodeJS.ProcessEnv, NOW))!
    const picks = rows.filter((r) => r.group === 'Draft picks')
    expect(picks).toHaveLength(MAX_PER_GROUP)
    expect(picks[0]).toEqual({ group: 'Draft picks', label: 'Next draft, 1st round', premiumPct: 15, trades: 388 })
    expect(picks.map((r) => r.premiumPct)).toEqual([15, 28, -9])
    expect(rows.find((r) => r.group === 'Team situation' && r.label === 'Contenders buying veterans')!.premiumPct).toBe(8)
    // An unpublished row stays, with what it still needs — never a number.
    expect(rows.find((r) => r.label === 'Rebuilding teams buying young players')).toEqual({ group: 'Team situation', label: 'Rebuilding teams buying young players', premiumPct: null, trades: 12, needed: 20 })
    // Need: only the "open slot" premium the grades apply.
    expect(rows.filter((r) => r.group === 'Roster need').map((r) => r.label)).toEqual(['Teams with an open TE slot'])
  })

  it('nothing published, a missing report, or a stale table: null, so the page keeps the sample', () => {
    expect(realTradeMarketRows(null)).toBeNull()
    expect(realTradeMarketRows(summarizeLearnedMarket({ picks: null, posture: null, need: null }, {} as NodeJS.ProcessEnv, NOW))).toBeNull()
    const old = { ...raw, picks: { ...raw.picks, generatedAt: '2026-10-01T00:00:00Z' }, posture: { ...raw.posture, generatedAt: '2026-10-01T00:00:00Z' }, need: { ...raw.need, generatedAt: '2026-10-01T00:00:00Z' } }
    expect(realTradeMarketRows(summarizeLearnedMarket(old, {} as NodeJS.ProcessEnv, NOW))).toBeNull()
  })
})

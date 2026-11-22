import { describe, expect, it, vi } from 'vitest'

import {
  computePickMarket,
  describePickMarket,
  equivalentRoundBucket,
  nextDraftYear,
  parsePicks,
  pickObservationFor,
  priorPickValue,
  PICK_MIN_EFFECTIVE_SAMPLE,
  type PickClassKey,
  type PickObservation,
} from '@/lib/trade-market/pickMarketLearner'
import { bookKey, gatherFormatObservations, recalculateFormatMarkets, teamsFromSettings } from '@/lib/trade-market/formatMarkets'
import { runScheduledMarketRecalc } from '@/lib/trade-market/scheduledMarketRecalc'
import { structuralWeight } from '@/lib/trade-market/datedMarketLearner'

/**
 * Trade learning, step 3 (owner's call, 2026-11-22): draft pick values learned from what the trades paid for them —
 * by round (as the 12-team round it equals) and by how many drafts away — in shadow until switched on.
 */

const DAY = 24 * 60 * 60 * 1000
const NOW = new Date('2026-11-22T12:00:00Z')
const daysAgo = (n: number) => new Date(NOW.getTime() - n * DAY)

describe('the pieces', () => {
  it('the draft a trade waits for: this year\'s until July, next year\'s from August', () => {
    expect(nextDraftYear(new Date('2026-03-01T00:00:00Z'))).toBe(2026)
    expect(nextDraftYear(new Date('2026-07-31T23:00:00Z'))).toBe(2026)
    expect(nextDraftYear(new Date('2026-08-01T00:00:00Z'))).toBe(2027)
    expect(nextDraftYear(new Date('2026-11-20T00:00:00Z'))).toBe(2027)
  })

  it('a round is read as the 12-team round it equals: identity at 12 teams, a 4-team 3rd is a 1st, a 32-team 2nd is late', () => {
    expect([1, 2, 3, 4, 5].map((r) => equivalentRoundBucket(r, 12))).toEqual([1, 2, 3, 4, 4])
    expect(equivalentRoundBucket(3, 4)).toBe(1)
    expect(equivalentRoundBucket(2, 32)).toBe(4)
    expect(equivalentRoundBucket(2, null)).toBe(2)
  })

  it('pick columns: {season, round} entries; anything unreadable is null, an empty or missing column is no picks', () => {
    expect(parsePicks([{ season: '2027', round: 1 }])).toEqual([{ season: 2027, round: 1 }])
    expect(parsePicks([{ season: 2027 }])).toBeNull()
    expect(parsePicks(['1.01'])).toBeNull()
    expect(parsePicks(null)).toEqual([])
    expect(teamsFromSettings({ num_teams: 10 })).toBe(10)
    expect(teamsFromSettings({ settings: { num_teams: 14 } })).toBe(14)
    expect(teamsFromSettings({ num_teams: 'many' })).toBeNull()
  })

  it('one trade, one equation: picks given count +, received −; the players and FAAB say what they had to make up', () => {
    const obs = pickObservationFor({
      transactionId: 't', tradeDate: new Date('2026-10-01T00:00:00Z'), teams: 12,
      picksGiven: [{ season: 2027, round: 1 }, { season: 2028, round: 2 }], picksReceived: [{ season: 2030, round: 3 }],
      playersGivenValue: 0, playersReceivedValue: 1500, faabReceivedValue: 50, faabGivenValue: 0, weight: 0.5,
    }) as PickObservation
    // Next draft is 2027 (traded in October): 2027 1st is horizon 0, 2028 2nd horizon 1, 2030 3rd capped at horizon 2.
    expect(obs.net).toEqual({ '1:0': 1, '2:1': 1, '3:2': -1 })
    expect(obs.y).toBe(1550)
    expect(obs.size).toBe(1500 + priorPickValue('1:0') + priorPickValue('2:1') + priorPickValue('3:2'))
    expect(obs.weight).toBe(0.5)
  })

  it('a trade it cannot read is named, not guessed: no picks, an unreadable pick, a pick already drafted, picks that cancel', () => {
    const base = { transactionId: 't', tradeDate: new Date('2026-10-01T00:00:00Z'), teams: 12, playersGivenValue: 900, playersReceivedValue: 900, weight: 1 }
    expect(pickObservationFor({ ...base, picksGiven: [], picksReceived: [] })).toBe('no_picks')
    expect(pickObservationFor({ ...base, picksGiven: [{ round: 1 }], picksReceived: [] })).toBe('unparseable_pick')
    expect(pickObservationFor({ ...base, picksGiven: [{ season: 2026, round: 1 }], picksReceived: [] })).toBe('pick_already_drafted')
    expect(pickObservationFor({ ...base, picksGiven: [{ season: 2027, round: 2 }], picksReceived: [{ season: 2027, round: 2 }] })).toBe('picks_cancel')
  })
})

/** Deterministic pseudo-random numbers, so the synthetic market is the same on every run. */
function rng(seed: number) {
  let s = seed >>> 0
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32)
}

/** A market where picks are worth TRUE: trades of one or two picks for players worth what they cost, ±10%. */
function syntheticTrades(truth: Partial<Record<PickClassKey, number>>, perClass: number, seed = 7, weight = () => 1): PickObservation[] {
  const r = rng(seed)
  const keys = Object.keys(truth) as PickClassKey[]
  const out: PickObservation[] = []
  for (const k of keys) {
    for (let i = 0; i < perClass; i++) {
      const net: Partial<Record<PickClassKey, number>> = { [k]: 1 }
      let worth = truth[k]!
      if (r() < 0.4) {
        // Sometimes a second pick rides along.
        const k2 = keys[Math.floor(r() * keys.length)]!
        net[k2] = (net[k2] ?? 0) + 1
        worth += truth[k2]!
      }
      const players = r() * 4000
      const y = worth * (0.9 + 0.2 * r())
      const size = players * 2 + y + Object.entries(net).reduce((s, [kk, c]) => s + priorPickValue(kk as PickClassKey) * (c as number), 0)
      out.push({ transactionId: `${k}-${i}`, net, y, size, weight: weight() })
    }
  }
  return out
}

const TRUTH: Partial<Record<PickClassKey, number>> = { '1:0': 1400, '1:1': 1000, '1:2': 750, '2:0': 500, '2:1': 420, '2:2': 330, '3:0': 230, '3:1': 200, '3:2': 160 }

describe('learning the values', () => {
  it('recovers what the trades paid: a next-draft 1st above the curve, a far 1st below it', () => {
    const m = computePickMarket(syntheticTrades(TRUTH, 80), NOW)
    for (const [k, v] of Object.entries(TRUTH)) {
      const c = m.classes.find((x) => x.key === k)!
      expect(c.published).toBe(true)
      expect(Math.abs(c.learned - v!) / v!).toBeLessThan(0.08)
    }
    expect(m.horizonsOrdered).toBe(true)
    expect(m.roundsOrdered).toBe(true)
    expect(describePickMarket('dynasty', m)).toContain('9/12 classes learned')
  })

  it('order is reported, never forced: a learned near 2nd below the curve\'s untouched far 2nd is flagged', () => {
    const { '2:2': _far, ...withoutFar } = TRUTH
    const m = computePickMarket(syntheticTrades(withoutFar, 80), NOW)
    // 2:1 learned ~420 while 2:2 keeps the curve's 456: a farther draft priced above a nearer one.
    expect(m.horizonsOrdered).toBe(false)
    expect(describePickMarket('dynasty', m)).toContain('farther draft priced above a nearer one')
  })

  it('a class with no trades keeps the curve, unpublished, and says why', () => {
    const m = computePickMarket(syntheticTrades(TRUTH, 80), NOW)
    const none = m.classes.find((c) => c.key === '4:2')!
    expect(none).toMatchObject({ published: false, trades: 0, value: Math.round(priorPickValue('4:2')) })
    expect(none.learned).toBe(Math.round(priorPickValue('4:2')))
    expect(none.note).toContain('kept the curve')
  })

  it('a handful of trades moves a class only part of the way, and does not publish it', () => {
    const m = computePickMarket(syntheticTrades({ '1:0': 1900 }, 8), NOW)
    const c = m.classes.find((x) => x.key === '1:0')!
    expect(c.effectiveSample).toBeLessThan(PICK_MIN_EFFECTIVE_SAMPLE)
    expect(c.published).toBe(false)
    expect(c.learned).toBeGreaterThan(950)
    expect(c.learned).toBeLessThan(1900 * 0.97)
    expect(c.value).toBe(950)
  })

  it('a few wild overpays cannot drag a class: they are down-weighted, not averaged in', () => {
    const fair = syntheticTrades({ '1:0': 1200 }, 70)
    // A 1st alone for a player worth 4,000 — a real-looking overpay, sized like an ordinary trade.
    const wild: PickObservation[] = Array.from({ length: 10 }, (_, i) => ({ transactionId: `wild-${i}`, net: { '1:0': 1 }, y: 4000, size: 4950, weight: 1 }))
    const c = computePickMarket([...fair, ...wild], NOW).classes.find((x) => x.key === '1:0')!
    expect(Math.abs(c.learned - 1200) / 1200).toBeLessThan(0.1)
  })

  it('recent trades decide: last month\'s price outweighs last year\'s', () => {
    const old = syntheticTrades({ '1:0': 800 }, 60, 3, () => Math.pow(0.5, 365 / 90))
    const recent = syntheticTrades({ '1:0': 1500 }, 60, 5, () => Math.pow(0.5, 30 / 90))
    const weighted = computePickMarket([...old, ...recent], NOW).classes.find((x) => x.key === '1:0')!.learned
    const flat = computePickMarket([...old, ...recent].map((o) => ({ ...o, weight: 1 })), NOW).classes.find((x) => x.key === '1:0')!.learned
    // Counted equally the two years split the difference; weighted by age, last month's price wins.
    expect(flat).toBeLessThan(1250)
    expect(weighted).toBeGreaterThan(1300)
  })
})

/** A 4-team superflex dynasty league: one trade of a next-draft 3rd — a 12-team 1st there — for a player, on the trade's day. */
function fakePrisma() {
  const tradeDay = Date.UTC(2026, 9, 10)
  const trades = [
    { transactionId: 't-pick', historyId: 'h', season: 2026, tradeDate: new Date(tradeDay + 3 * 3600_000), playersGiven: [], playersReceived: ['2'], picksGiven: [{ season: 2027, round: 3 }], picksReceived: [] },
    { transactionId: 't-plain', historyId: 'h', season: 2026, tradeDate: new Date(tradeDay + 3 * 3600_000), playersGiven: ['1'], playersReceived: ['2'], picksGiven: [], picksReceived: [] },
  ]
  return {
    leagueTrade: { findMany: async () => trades },
    leagueTradeHistory: { findMany: async () => [{ id: 'h', sleeperLeagueId: 'P-SF' }] },
    league: { findMany: async () => [{ id: 'L', platformLeagueId: 'P-SF', leagueType: 'dynasty', settings: { num_teams: 4, roster_positions: ['QB', 'SUPER_FLEX', 'RB', 'WR', 'TE'] } }] },
    leagueSeason: { findMany: async () => [] },
    leagueDynastySeason: { findMany: async () => [] },
    $queryRaw: async (q: { sql: string; values: unknown[] }) => {
      if (q.sql.includes('date_trunc')) return q.values[0] === 'DYNASTY' && q.values[1] === 'SUPERFLEX' ? [{ day: new Date(tradeDay) }] : []
      if (!q.sql.includes('PlayerValueSnapshot')) return []
      const [ids, , format, qbFormat] = q.values as [string[], string, string, string]
      return format === 'DYNASTY' && qbFormat === 'SUPERFLEX' ? ids.map((id) => ({ sleeperId: id, value: 3000 })) : []
    },
    playerValueSnapshot: {
      findMany: async (a: { where: { sleeperId: { in: string[] }; capturedAt: { gte: Date } } }) =>
        a.where.capturedAt.gte.getTime() === tradeDay ? a.where.sleeperId.in.map((id) => ({ sleeperId: id, value: id === '2' ? 1300 : 2000 })) : [],
    },
    sportsPlayer: { findMany: async () => [] },
    allFantasyMarketPlayerValue: { findUnique: async () => null, upsert: async () => ({ id: 'row', marketValue: 0 }) },
    allFantasyMarketValueAudit: { create: async () => ({}) },
  }
}

describe('reading the trades', () => {
  it('a dynasty trade with a pick becomes an equation on its own day\'s chart; a trade with no pick adds none', async () => {
    const g = await gatherFormatObservations(fakePrisma() as never, { sinceSeason: 2024, now: NOW })
    const picks = g.byBookPicks.get(bookKey({ format: 'DYNASTY', qbFormat: 'SUPERFLEX' }))!
    expect(picks.observations).toHaveLength(1)
    // The 2027 3rd of a 4-team league (a 12-team 1st; next draft, traded in October) bought a player worth 1300 that
    // day — not today's 3000.
    expect(picks.observations[0]).toMatchObject({ transactionId: 't-pick', net: { '1:0': 1 }, y: 1300 })
    // Weighted on the two-year structural half-life, not the player market's 90 days.
    expect(picks.observations[0]!.weight).toBeCloseTo(structuralWeight(new Date(Date.UTC(2026, 9, 10) + 3 * 3600_000), NOW), 6)
    expect(picks.skipped).toEqual({})
    expect(g.byBookPicks.has(bookKey({ format: 'REDRAFT', qbFormat: 'SUPERFLEX' }))).toBe(false)
  })

  it('every run computes it for both dynasty books; TRADE_PICK_LEARNER=off computes nothing', async () => {
    const on = await recalculateFormatMarkets(fakePrisma() as never, { sinceSeason: 2024, dryRun: true, now: NOW, env: {} })
    expect(on.pickMarkets.map((m) => bookKey(m.book))).toEqual(['DYNASTY:ONE_QB', 'DYNASTY:SUPERFLEX'])
    expect(on.pickMarkets[1]!.tradesUsed).toBe(1)
    const off = await recalculateFormatMarkets(fakePrisma() as never, { sinceSeason: 2024, dryRun: true, now: NOW, env: { TRADE_PICK_LEARNER: 'off' } })
    expect(off.pickMarkets).toEqual([])
  })
})

describe('the scheduled run', () => {
  it('stores the structural pass\'s pick market (every season from 2020) once; its failure falls back to the widest window', async () => {
    const market = (tradesUsed: number) => ({ book: { format: 'DYNASTY' as const, qbFormat: 'SUPERFLEX' as const }, concept: 'c', generatedAt: '', tradesUsed, classes: [], roundsOrdered: true, horizonsOrdered: true, skipped: {} })
    const recalc = vi.fn(async (_p: unknown, o: { sinceSeason: number }) => ({
      books: [], pickMarkets: [market(o.sinceSeason)], lineup: { factors: [] } as never, lineupWritten: false, tradesUsed: 0, tradesStamped: 0, skipped: {},
    }))
    const writePicks = vi.fn(async () => undefined)
    const r = await runScheduledMarketRecalc({} as never, { now: NOW, recalc: recalc as never, writeLineup: vi.fn() as never, stampAll: vi.fn(async () => null) as never, writePicks })
    expect(writePicks).toHaveBeenCalledTimes(1)
    expect(r.pickMarkets.map((m) => m.sinceSeason)).toEqual([2020])
    expect(r.pickMarkets[0]!.tradesUsed).toBe(2020)
    expect(r.pickMarketsWritten).toBe(true)
    expect(r.structural).toMatchObject({ sinceSeason: 2020, ok: true })
    // The structural pass skips every book, so no market is rewritten by it.
    const structuralCall = recalc.mock.calls.find((c) => (c[1] as { sinceSeason: number }).sinceSeason === 2020)![1] as { skipBooks: Set<string>; stampTrades: boolean }
    expect(structuralCall.skipBooks.size).toBe(4)
    expect(structuralCall.stampTrades).toBe(false)

    const structuralFails = vi.fn(async (_p: unknown, o: { sinceSeason: number }) => {
      if (o.sinceSeason === 2020) throw new Error('timeout')
      return { books: [], pickMarkets: [market(o.sinceSeason)], lineup: { factors: [] } as never, lineupWritten: false, tradesUsed: 0, tradesStamped: 0, skipped: {} }
    })
    const fallback = await runScheduledMarketRecalc({} as never, { now: NOW, recalc: structuralFails as never, writeLineup: vi.fn() as never, stampAll: vi.fn(async () => null) as never, writePicks: vi.fn(async () => undefined) })
    expect(fallback.pickMarkets.map((m) => m.sinceSeason)).toEqual([2024])
    expect(fallback.structural.ok).toBe(false)

    const failing = await runScheduledMarketRecalc({} as never, { now: NOW, recalc: recalc as never, writeLineup: vi.fn() as never, stampAll: vi.fn(async () => null) as never, writePicks: vi.fn(async () => { throw new Error('db down') }) })
    expect(failing.pickMarketsWritten).toBe(false)
  })
})

void daysAgo

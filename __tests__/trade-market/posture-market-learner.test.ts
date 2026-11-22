import { describe, expect, it, vi } from 'vitest'

import {
  ageAtTrade,
  computePostureMarket,
  describePostureMarket,
  packageKind,
  postureOf,
  POSTURE_MAX_PREMIUM_PCT,
  type PostureObservation,
} from '@/lib/trade-market/postureMarketLearner'
import { bookKey, postureObservationsFor, recalculateFormatMarkets } from '@/lib/trade-market/formatMarkets'
import { runScheduledMarketRecalc } from '@/lib/trade-market/scheduledMarketRecalc'

/**
 * Trade learning, step 5 (owner's call, 2026-11-22): what a contender pays over a middle team for veterans, youth and
 * picks — and what a rebuilder pays — measured from completed trades on each trade's own day, in shadow.
 */

const NOW = new Date('2026-11-22T12:00:00Z')

describe('the pieces', () => {
  it('posture from the record before the trade, once the season has spoken', () => {
    expect(postureOf({ wins: 6, losses: 2, ties: 0 }, 9)).toBe('contend')
    expect(postureOf({ wins: 2, losses: 6, ties: 0 }, 9)).toBe('rebuild')
    expect(postureOf({ wins: 4, losses: 4, ties: 0 }, 9)).toBe('middle')
    expect(postureOf({ wins: 3, losses: 2, ties: 1 }, 7)).toBe('middle') // 3.5 / 6 = .583
    expect(postureOf({ wins: 3, losses: 0, ties: 0 }, 3)).toBeNull() // before week 4
    expect(postureOf({ wins: 2, losses: 0, ties: 0 }, 6)).toBeNull() // two games is not a record
    expect(postureOf(null, 9)).toBeNull()
  })

  it('a player\'s age on the trade date, and the kind a package is by the majority of its value', () => {
    expect(ageAtTrade(28, new Date('2025-11-22T12:00:00Z'), NOW)).toBeCloseTo(27, 1)
    expect(ageAtTrade(null, NOW, NOW)).toBeNull()
    expect(packageKind([{ kind: 'veteran', value: 700 }, { kind: 'youth', value: 300 }])).toBe('veteran')
    expect(packageKind([{ kind: 'veteran', value: 500 }, { kind: 'picks', value: 500 }])).toBeNull()
    expect(packageKind([])).toBeNull()
  })
})

// A week-9 trade: roster 3 (6-2, a contender) gives a 2027 1st and a 23-year-old for roster 7's (2-6) 29-year-old.
const snapshot = {
  version: 1,
  sides: [
    { rosterId: '3', record: { wins: 6, losses: 2, ties: 0 } },
    { rosterId: '7', record: { wins: 2, losses: 6, ties: 0 } },
  ],
}
const row = {
  transactionId: 'tx', tradeDate: new Date('2026-11-01T18:00:00Z'), week: 9,
  // The row is roster 3's side: its partner is roster 7.
  partnerRosterId: 7, contextSnapshot: snapshot,
  playersGiven: ['young'], playersReceived: ['vet'], picksGiven: [{ season: 2027, round: 1 }], picksReceived: [],
}
const chart = new Map([['young', 1000], ['vet', 2500]])
const meta = new Map([['young', { age: 23 }], ['vet', { age: 29 }]])

describe('reading one trade', () => {
  it('each side: who bought, what they bought, what they paid on that day\'s chart', () => {
    const obs = postureObservationsFor(row as never, chart, meta, null, { faabBudget: 100 }, 0.8, NOW)
    if (!Array.isArray(obs)) throw new Error(obs)
    // Roster 3 bought a veteran for 1000 + a 950 first: paid 1950 for 2500.
    expect(obs[0]).toMatchObject({ buyer: 'contend', bought: 'veteran', weight: 0.8 })
    expect(obs[0]!.ratio).toBeCloseTo(1950 / 2500, 6)
    // Roster 7 bought 1000 of youth and a 950 pick: neither is 60% of the package, so that side is mixed and not used.
    expect(obs).toHaveLength(1)
  })

  it('the rebuilder\'s side counts when its package is one kind', () => {
    const picksOnly = { ...row, playersGiven: [], picksGiven: [{ season: 2027, round: 1 }, { season: 2028, round: 1 }] }
    const obs = postureObservationsFor(picksOnly as never, chart, meta, null, { faabBudget: 100 }, 1, NOW)
    if (!Array.isArray(obs)) throw new Error(obs)
    expect(obs.map((o) => [o.buyer, o.bought])).toEqual([['contend', 'veteran'], ['rebuild', 'picks']])
    expect(obs[1]!.ratio).toBeCloseTo(2500 / 1900, 6)
  })

  it('says why when it cannot read one: no context, an unavailable marker, too early in the season, an unpriced player', () => {
    const r = (over: Record<string, unknown>) => postureObservationsFor({ ...row, ...over } as never, chart, meta, null, { faabBudget: 100 }, 1, NOW)
    expect(r({ contextSnapshot: null })).toBe('no_context')
    expect(r({ contextSnapshot: { unavailable: 'no_trade_week' } })).toBe('no_context')
    expect(r({ week: 2 })).toBe('no_posture')
    expect(r({ playersReceived: ['unknown'] })).toBe('unpriced_player')
  })

  it('an unknown age is not read as young (or old): that package has no kind, and the side is not used', () => {
    const noAges = new Map<string, { age?: number | null }>([['young', { age: 23 }], ['vet', { age: null }]])
    expect(postureObservationsFor(row as never, chart, noAges, null, { faabBudget: 100 }, 1, NOW)).toBe('mixed_package')
  })
})

/** Deterministic noise. */
function rng(seed: number) {
  let s = seed >>> 0
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32)
}
function group(buyer: PostureObservation['buyer'], bought: PostureObservation['bought'], ratio: number, n: number, seed: number): PostureObservation[] {
  const r = rng(seed)
  return Array.from({ length: n }, (_, i) => ({ transactionId: `${buyer}-${bought}-${i}`, buyer, bought, ratio: ratio * (0.92 + 0.16 * r()), weight: 1 }))
}

describe('the premiums', () => {
  it('a contender\'s premium for veterans is measured against what middle teams pay for them, not against the chart', () => {
    // Everyone pays ~10% over the chart for veterans; contenders pay ~21% — a 10% posture premium.
    const m = computePostureMarket([...group('middle', 'veteran', 1.1, 60, 1), ...group('contend', 'veteran', 1.21, 60, 2)], NOW)
    const p = m.premiums.find((x) => x.buyer === 'contend' && x.bought === 'veteran')!
    expect(p.published).toBe(true)
    expect(p.premiumPct!).toBeGreaterThan(7)
    expect(p.premiumPct!).toBeLessThan(13)
    expect(describePostureMarket('dynasty', m)).toContain('contend buying veteran +')
  })

  it('a rebuilder pays up for picks; a class without enough trades on either side is reported, not published', () => {
    const m = computePostureMarket([
      ...group('middle', 'picks', 1.0, 50, 3), ...group('rebuild', 'picks', 1.15, 50, 4),
      ...group('contend', 'youth', 0.8, 50, 5), ...group('middle', 'youth', 1.0, 5, 6),
    ], NOW)
    const picks = m.premiums.find((x) => x.buyer === 'rebuild' && x.bought === 'picks')!
    expect(picks.published).toBe(true)
    expect(picks.premiumPct!).toBeGreaterThan(10)
    const thin = m.premiums.find((x) => x.buyer === 'contend' && x.bought === 'youth')!
    expect(thin.published).toBe(false)
    expect(thin.note).toContain('not enough trades')
  })

  it('held to the cap, and a few wild deals do not move a median', () => {
    const wild = group('contend', 'veteran', 3, 60, 7)
    const capped = computePostureMarket([...group('middle', 'veteran', 1, 60, 8), ...wild], NOW).premiums.find((x) => x.buyer === 'contend' && x.bought === 'veteran')!
    expect(capped.premiumPct).toBe(POSTURE_MAX_PREMIUM_PCT)
    expect(capped.note).toContain('held to')
    const fewWild = [...group('contend', 'veteran', 1.1, 60, 9), ...Array.from({ length: 8 }, (_, i) => ({ transactionId: `w${i}`, buyer: 'contend' as const, bought: 'veteran' as const, ratio: 10, weight: 1 }))]
    const robust = computePostureMarket([...group('middle', 'veteran', 1, 60, 10), ...fewWild], NOW).premiums.find((x) => x.buyer === 'contend' && x.bought === 'veteran')!
    expect(robust.premiumPct!).toBeLessThan(16)
  })

  it('recent trades decide', () => {
    const old = group('contend', 'veteran', 1.0, 60, 11).map((o) => ({ ...o, weight: 0.05 }))
    const recent = group('contend', 'veteran', 1.2, 40, 12)
    const p = computePostureMarket([...group('middle', 'veteran', 1, 60, 13), ...old, ...recent], NOW).premiums.find((x) => x.buyer === 'contend' && x.bought === 'veteran')!
    expect(p.premiumPct!).toBeGreaterThan(15)
  })
})

/** One superflex dynasty league, one week-9 trade with context: a contender buys a veteran from a rebuilder. */
function fakePrisma() {
  const tradeDay = Date.UTC(2026, 10, 1)
  const trades = [{ ...row, historyId: 'h', season: 2026, tradeDate: new Date(tradeDay + 3 * 3600_000), picksGiven: [] }]
  return {
    leagueTrade: { findMany: async () => trades },
    leagueTradeHistory: { findMany: async () => [{ id: 'h', sleeperLeagueId: 'P-SF' }] },
    league: { findMany: async () => [{ id: 'L', platformLeagueId: 'P-SF', leagueType: 'dynasty', settings: { roster_positions: ['QB', 'SUPER_FLEX', 'RB', 'WR', 'TE'] } }] },
    leagueSeason: { findMany: async () => [] },
    leagueDynastySeason: { findMany: async () => [] },
    $queryRaw: async (q: { sql: string; values: unknown[] }) => {
      if (q.sql.includes('date_trunc')) return q.values[0] === 'DYNASTY' && q.values[1] === 'SUPERFLEX' ? [{ day: new Date(tradeDay) }] : []
      if (!q.sql.includes('PlayerValueSnapshot')) return []
      const [ids] = q.values as [string[]]
      return ids.map((id) => ({ sleeperId: id, value: 2000 }))
    },
    playerValueSnapshot: {
      findMany: async (a: { where: { sleeperId: { in: string[] }; capturedAt: { gte: Date } } }) =>
        a.where.capturedAt.gte.getTime() === tradeDay ? a.where.sleeperId.in.map((id) => ({ sleeperId: id, value: chart.get(id) })) : [],
    },
    sportsPlayer: {
      findMany: async () => [
        { sleeperId: 'young', name: 'Young Gun', position: 'WR', age: 23, source: 'sleeper', fetchedAt: new Date() },
        { sleeperId: 'vet', name: 'Old Hand', position: 'WR', age: 29, source: 'sleeper', fetchedAt: new Date() },
      ],
    },
    allFantasyMarketPlayerValue: { findUnique: async () => null, upsert: async () => ({ id: 'row', marketValue: 0 }) },
    allFantasyMarketValueAudit: { create: async () => ({}) },
  }
}

describe('reading the trades', () => {
  it('a run reads each side\'s posture from the saved context and ages from the player table; off reads nothing', async () => {
    const on = await recalculateFormatMarkets(fakePrisma() as never, { sinceSeason: 2024, dryRun: true, now: NOW, env: {} })
    const sf = on.postureMarkets.find((m) => bookKey(m.book) === 'DYNASTY:SUPERFLEX')!
    // The contender gave a 23-year-old (1000) for a 29-year-old (2500): one side, buying a veteran; the rebuilder bought youth.
    expect(sf.observations).toBe(2)
    expect(on.postureMarkets).toHaveLength(4)
    const off = await recalculateFormatMarkets(fakePrisma() as never, { sinceSeason: 2024, dryRun: true, now: NOW, env: { TRADE_POSTURE_LEARNER: 'off' } })
    expect(off.postureMarkets).toEqual([])
  })

  it('the scheduled run keeps the widest window and stores it once', async () => {
    const market = (n: number) => ({ book: { format: 'DYNASTY' as const, qbFormat: 'SUPERFLEX' as const }, concept: 'c', generatedAt: '', observations: n, premiums: [], skipped: {} })
    const recalc = vi.fn(async (_p: unknown, o: { sinceSeason: number }) => ({
      books: [], pickMarkets: [], postureMarkets: [market(o.sinceSeason)], lineup: { factors: [] } as never, lineupWritten: false, tradesUsed: 0, tradesStamped: 0, skipped: {},
    }))
    const writePosture = vi.fn(async () => undefined)
    const r = await runScheduledMarketRecalc({} as never, { now: NOW, recalc: recalc as never, writeLineup: vi.fn() as never, stampAll: vi.fn(async () => null) as never, writePicks: vi.fn(async () => undefined), writePosture })
    expect(writePosture).toHaveBeenCalledTimes(1)
    expect(r.postureMarkets.map((m) => m.observations)).toEqual([2024])
    expect(r.postureMarketsWritten).toBe(true)
  })
})

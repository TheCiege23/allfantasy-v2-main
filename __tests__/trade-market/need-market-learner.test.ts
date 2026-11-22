import { describe, expect, it, vi } from 'vitest'

import {
  computeNeedMarket,
  describeNeedMarket,
  needAt,
  NEED_MAX_PREMIUM_PCT,
  packagePosition,
  slotsFromRosterPositions,
  startersRequired,
  type NeedObservation,
} from '@/lib/trade-market/needMarketLearner'
import { bookKey, needObservationsFor, recalculateFormatMarkets } from '@/lib/trade-market/formatMarkets'
import { runScheduledMarketRecalc } from '@/lib/trade-market/scheduledMarketRecalc'

/**
 * Trade learning, step 6 (owner's call, 2026-11-22): what a team short of a position pays for it — a third quarterback
 * in superflex, a tight end when its own is out — over what a team of normal depth pays, from completed trades.
 */

const NOW = new Date('2026-11-22T12:00:00Z')
const SF_SLOTS = { QB: 1, SUPER_FLEX: 1, RB: 2, WR: 3, TE: 1, FLEX: 1 }
const roster = (counts: Record<string, number>) =>
  Object.entries(counts).flatMap(([pos, n]) => Array.from({ length: n }, (_, i) => ({ id: `${pos}${i}`, position: pos })))

describe('the pieces', () => {
  it('starters a league requires at a position: superflex counts toward QB, flex toward nothing', () => {
    expect(startersRequired(SF_SLOTS, 'QB')).toBe(2)
    expect(startersRequired(SF_SLOTS, 'WR')).toBe(3)
    expect(startersRequired({ QB: 1, RB: 2 }, 'TE')).toBeNull()
    expect(slotsFromRosterPositions(['QB', 'SUPER_FLEX', 'RB', 'BN', 'BN', 'IR', 'TAXI'])).toEqual({ QB: 1, SUPER_FLEX: 1, RB: 1 })
  })

  it('need: two quarterbacks in superflex is short — the third-QB case — four is normal, five is deep', () => {
    expect(needAt(roster({ QB: 2, WR: 5 }), SF_SLOTS, 'QB')).toBe('short')
    expect(needAt(roster({ QB: 3 }), SF_SLOTS, 'QB')).toBe('normal')
    expect(needAt(roster({ QB: 5 }), SF_SLOTS, 'QB')).toBe('deep')
    expect(needAt(roster({ TE: 1 }), SF_SLOTS, 'TE')).toBe('short')
    expect(needAt([], SF_SLOTS, 'TE')).toBeNull()
  })

  it('an unknown player is not an absent one: the level counts only if it holds either way', () => {
    // One TE and one unknown: short if the unknown is not a TE, normal if he is — cannot say.
    expect(needAt([{ position: 'TE' }, { position: null }], SF_SLOTS, 'TE')).toBeNull()
    // Six receivers and one unknown: deep either way.
    expect(needAt([...roster({ WR: 6 }), { position: null }], SF_SLOTS, 'WR')).toBe('deep')
  })

  it('a package is one position by most of its value, picks and FAAB counting against it', () => {
    expect(packagePosition([{ position: 'QB', value: 3000 }, { position: 'WR', value: 500 }])).toBe('QB')
    expect(packagePosition([{ position: 'QB', value: 1000 }, { position: null, value: 1000 }])).toBeNull()
  })
})

// Week 9, superflex: roster 3 (two QBs) gives a receiver for roster 7's quarterback; roster 7 holds three receivers for three WR slots.
const snapshot = {
  version: 1,
  starterSlots: SF_SLOTS,
  sides: [
    { rosterId: '3', record: { wins: 5, losses: 3, ties: 0 }, rosterBefore: roster({ QB: 2, WR: 6, RB: 4, TE: 2 }) },
    { rosterId: '7', record: { wins: 4, losses: 4, ties: 0 }, rosterBefore: roster({ QB: 4, WR: 3, RB: 4, TE: 2 }) },
  ],
}
const row = {
  transactionId: 'tx', partnerRosterId: 7, contextSnapshot: snapshot,
  playersGiven: ['wr-x'], playersReceived: ['qb-x'], picksGiven: [], picksReceived: [],
}
const chart = new Map([['wr-x', 3300], ['qb-x', 3000]])
const meta = new Map([['wr-x', { position: 'WR' }], ['qb-x', { position: 'QB' }]])

describe('reading one trade', () => {
  it('each buyer\'s need at what it bought, from its own roster before the trade', () => {
    const obs = needObservationsFor(row as never, chart, meta, null, { faabBudget: 100 }, 0.7)
    if (!Array.isArray(obs)) throw new Error(obs)
    // Roster 3 (two QBs in superflex) bought a quarterback, paying 3300 for 3000.
    expect(obs[0]).toMatchObject({ position: 'QB', need: 'short', weight: 0.7 })
    expect(obs[0]!.ratio).toBeCloseTo(1.1, 6)
    // Roster 7 (three receivers, three WR starters) bought a receiver: short too, paying 3000 for 3300.
    expect(obs[1]).toMatchObject({ position: 'WR', need: 'short' })
    expect(obs[1]!.ratio).toBeCloseTo(3000 / 3300, 6)
  })

  it('slots from the league\'s roster positions when the context has none; says why when it cannot read one', () => {
    const noSlots = { ...snapshot, starterSlots: null, league: { roster_positions: ['QB', 'SUPER_FLEX', 'WR', 'WR', 'WR', 'BN'] } }
    const obs = needObservationsFor({ ...row, contextSnapshot: noSlots } as never, chart, meta, null, { faabBudget: 100 }, 1)
    if (!Array.isArray(obs)) throw new Error(obs)
    expect(obs[0]).toMatchObject({ position: 'QB', need: 'short' })
    const r = (over: Record<string, unknown>) => needObservationsFor({ ...row, ...over } as never, chart, meta, null, { faabBudget: 100 }, 1)
    expect(r({ contextSnapshot: { ...snapshot, starterSlots: null } })).toBe('no_slots')
    expect(r({ contextSnapshot: null })).toBe('no_context')
    expect(r({ playersReceived: ['nobody'] })).toBe('unpriced_player')
    // Four firsts riding along on BOTH sides: neither package is mostly one position.
    const firsts = [{ season: 2027, round: 1 }, { season: 2027, round: 1 }, { season: 2028, round: 1 }, { season: 2028, round: 1 }]
    expect(r({ picksReceived: firsts, picksGiven: firsts })).toBe('not_one_position')
  })
})

function rng(seed: number) {
  let s = seed >>> 0
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32)
}
function group(position: NeedObservation['position'], need: NeedObservation['need'], ratio: number, n: number, seed: number): NeedObservation[] {
  const r = rng(seed)
  return Array.from({ length: n }, (_, i) => ({ transactionId: `${position}-${need}-${i}`, position, need, ratio: ratio * (0.92 + 0.16 * r()), weight: 1 }))
}

describe('the premiums', () => {
  it('a team short at QB pays over what a normal-depth team pays for a QB — not over the chart', () => {
    // Everyone pays 5% over the chart for quarterbacks; teams short of one pay ~18%: a ~12% need premium.
    const m = computeNeedMarket([...group('QB', 'normal', 1.05, 60, 1), ...group('QB', 'short', 1.18, 60, 2)], NOW)
    const p = m.premiums.find((x) => x.position === 'QB' && x.need === 'short')!
    expect(p.published).toBe(true)
    expect(p.premiumPct!).toBeGreaterThan(9)
    expect(p.premiumPct!).toBeLessThan(16)
    expect(describeNeedMarket('superflex', m)).toContain('short at QB +')
  })

  it('a deep team pays less; a thin group is reported, not published; held to the cap', () => {
    const m = computeNeedMarket([...group('WR', 'normal', 1, 60, 3), ...group('WR', 'deep', 0.9, 60, 4), ...group('TE', 'short', 1.3, 6, 5), ...group('TE', 'normal', 1, 60, 6)], NOW)
    expect(m.premiums.find((x) => x.position === 'WR' && x.need === 'deep')!.premiumPct!).toBeLessThan(-5)
    const thin = m.premiums.find((x) => x.position === 'TE' && x.need === 'short')!
    expect(thin.published).toBe(false)
    expect(thin.note).toContain('not enough trades')
    const wild = computeNeedMarket([...group('RB', 'normal', 1, 60, 7), ...group('RB', 'short', 3, 60, 8)], NOW).premiums.find((x) => x.position === 'RB' && x.need === 'short')!
    expect(wild.premiumPct).toBe(NEED_MAX_PREMIUM_PCT)
  })

  it('recent trades decide', () => {
    const old = group('TE', 'short', 1.0, 60, 9).map((o) => ({ ...o, weight: 0.05 }))
    const p = computeNeedMarket([...group('TE', 'normal', 1, 60, 10), ...old, ...group('TE', 'short', 1.2, 40, 11)], NOW).premiums.find((x) => x.position === 'TE' && x.need === 'short')!
    expect(p.premiumPct!).toBeGreaterThan(15)
  })
})

function fakePrisma() {
  const tradeDay = Date.UTC(2026, 10, 1)
  const trades = [{ ...row, historyId: 'h', season: 2026, week: 9, tradeDate: new Date(tradeDay + 3 * 3600_000) }]
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
        { sleeperId: 'wr-x', name: 'A Receiver', position: 'WR', age: 26, source: 'sleeper', fetchedAt: new Date() },
        { sleeperId: 'qb-x', name: 'A Passer', position: 'QB', age: 26, source: 'sleeper', fetchedAt: new Date() },
      ],
    },
    allFantasyMarketPlayerValue: { findUnique: async () => null, upsert: async () => ({ id: 'row', marketValue: 0 }) },
    allFantasyMarketValueAudit: { create: async () => ({}) },
  }
}

describe('reading the trades', () => {
  it('a run reads need from the saved rosters and positions from the player table; off reads nothing', async () => {
    const on = await recalculateFormatMarkets(fakePrisma() as never, { sinceSeason: 2024, dryRun: true, now: NOW, env: {} })
    expect(on.needMarkets).toHaveLength(4)
    expect(on.needMarkets.find((m) => bookKey(m.book) === 'DYNASTY:SUPERFLEX')!.observations).toBe(2)
    const off = await recalculateFormatMarkets(fakePrisma() as never, { sinceSeason: 2024, dryRun: true, now: NOW, env: { TRADE_NEED_LEARNER: 'off' } })
    expect(off.needMarkets).toEqual([])
  })

  it('the scheduled run keeps the widest window and stores it once', async () => {
    const market = (n: number) => ({ book: { format: 'DYNASTY' as const, qbFormat: 'SUPERFLEX' as const }, concept: 'c', generatedAt: '', observations: n, premiums: [], skipped: {} })
    const recalc = vi.fn(async (_p: unknown, o: { sinceSeason: number }) => ({
      books: [], pickMarkets: [], postureMarkets: [], needMarkets: [market(o.sinceSeason)], lineup: { factors: [] } as never, lineupWritten: false, tradesUsed: 0, tradesStamped: 0, skipped: {},
    }))
    const writeNeed = vi.fn(async () => undefined)
    const r = await runScheduledMarketRecalc({} as never, {
      now: NOW, recalc: recalc as never, writeLineup: vi.fn() as never, stampAll: vi.fn(async () => null) as never,
      writePicks: vi.fn(async () => undefined), writePosture: vi.fn(async () => undefined), writeNeed,
    })
    expect(writeNeed).toHaveBeenCalledTimes(1)
    expect(r.needMarkets.map((m) => m.observations)).toEqual([2024])
    expect(r.needMarketsWritten).toBe(true)
  })
})

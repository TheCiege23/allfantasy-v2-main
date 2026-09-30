// @vitest-environment node
/**
 * 🛑 The trade-learning writer, now scheduled (2026-09-30) — market values only, by the owner's ruling.
 *
 * It priced each player at `dynastyScore || fantasyCalcValue || 200`: the dynasty-tiers score first
 * (ruled not authoritative) and a flat 200 for anyone FantasyCalc did not know (an invented number).
 * Nothing called it, so 25,970 trades sat unanalyzed and the AI read an empty learning context. These
 * pin what it does now that it runs: FantasyCalc values only, refusal over guessing, a bounded pass, a
 * throttled aggregation, and no dynasty-tier figure in the text the AI reads.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Row = Record<string, unknown>

const h = vi.hoisted(() => ({
  trades: [] as Array<Record<string, unknown>>,
  updates: [] as Array<{ id: string; data: Record<string, unknown> }>,
  insights: [] as Array<Record<string, unknown>>,
  stats: new Map<number, Record<string, unknown>>(),
  fc: [] as unknown[],
}))

vi.mock('@/lib/fantasycalc-db', () => ({ getFantasyCalcValuesDbFirst: vi.fn(async () => h.fc) }))
vi.mock('@/lib/prisma', () => {
  const byWhere = (t: Record<string, unknown>, where: Record<string, unknown>) =>
    (where.analyzed === undefined || t.analyzed === where.analyzed) &&
    (!where.valueGiven || t.valueGiven != null)
  const prisma = {
    leagueTrade: {
      findMany: vi.fn(async ({ where, take }: { where: Record<string, unknown>; take?: number }) =>
        h.trades.filter((t) => byWhere(t, where)).slice(0, take ?? Infinity),
      ),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        h.updates.push({ id: where.id, data })
        const t = h.trades.find((x) => x.id === where.id)
        if (t) Object.assign(t, data)
        return t
      }),
      count: vi.fn(async ({ where }: { where: Record<string, unknown> }) => h.trades.filter((t) => byWhere(t, where)).length),
    },
    leagueTradeHistory: { count: vi.fn(async () => 7) },
    tradeLearningStats: {
      findFirst: vi.fn(async ({ where }: { where: { season: number } }) => h.stats.get(where.season) ?? null),
      findUnique: vi.fn(async ({ where }: { where: { season: number } }) => h.stats.get(where.season) ?? null),
      create: vi.fn(async ({ data }: { data: Row }) => {
        const row = { id: `s${data.season}`, createdAt: new Date(), lastUpdated: new Date(), ...data }
        h.stats.set(data.season as number, row)
        return row
      }),
      delete: vi.fn(async ({ where }: { where: { id: string } }) => {
        for (const [k, v] of h.stats) if (v.id === where.id) h.stats.delete(k)
      }),
      deleteMany: vi.fn(async ({ where }: { where: { season: number } }) => {
        h.stats.delete(where.season)
      }),
      upsert: vi.fn(async ({ where, create, update }: { where: { season: number }; create: Row; update: Row }) => {
        const held = h.stats.get(where.season)
        const row = { id: `s${where.season}`, ...(held ?? create), ...(held ? update : {}), lastUpdated: new Date() }
        h.stats.set(where.season, row)
        return row
      }),
    },
    tradeLearningInsight: {
      findFirst: vi.fn(async () => null),
      findMany: vi.fn(async () => h.insights),
      create: vi.fn(async ({ data }: { data: Row }) => {
        h.insights.push({ ...data })
        return data
      }),
      update: vi.fn(async () => ({})),
    },
  }
  return { prisma }
})

import {
  collectTradeMarketFacts,
  getComprehensiveLearningContext,
  runComprehensiveBackgroundAnalysis,
} from '@/lib/comprehensive-trade-learning'

const fcPlayer = (sleeperId: string, name: string, position: string, value: number, overallRank: number, age = 25) => ({
  player: { sleeperId, name, position, maybeAge: age },
  value,
  overallRank,
})

const trade = (id: string, given: string[], received: string[], extra: Record<string, unknown> = {}) => ({
  id,
  analyzed: false,
  season: 2026,
  leagueFormat: 'dynasty',
  isSuperFlex: false,
  sport: 'nfl',
  playersGiven: given.map((pid) => ({ id: pid, name: `P${pid}`, position: 'WR' })),
  picksGiven: [],
  playersReceived: received.map((pid) => ({ id: pid, name: `P${pid}`, position: 'WR' })),
  picksReceived: [],
  valueGiven: null,
  valueReceived: null,
  valueDifferential: null,
  analysisResult: null,
  createdAt: new Date(),
  ...extra,
})

beforeEach(() => {
  h.trades = []
  h.updates = []
  h.insights = []
  h.stats = new Map()
  h.fc = [
    fcPlayer('1', 'P1', 'WR', 5000, 10),
    fcPlayer('2', 'P2', 'WR', 4000, 40),
    fcPlayer('3', 'P3', 'WR', 4100, 38),
  ]
})

describe('collectTradeMarketFacts — FantasyCalc values only, facts not a verdict', () => {
  it('prices each side at the market value and flags elite by market rank', async () => {
    const a = await collectTradeMarketFacts(trade('t1', ['1'], ['2']))
    expect(a).toMatchObject({ valueGiven: 5000, valueReceived: 4000, percentDiff: 20, involvesEliteAsset: true })
    // It records the gap; whether that is "fair" is the engine's call (canonicalFairnessGrade), not this module's.
    expect(a).not.toHaveProperty('isFairTrade')
    expect(a).not.toHaveProperty('dynastyTierScore')
    expect(JSON.stringify(a)).not.toMatch(/dynasty/i)
  })

  it('refuses a trade with a player FantasyCalc cannot price — no invented 200', async () => {
    expect(await collectTradeMarketFacts(trade('t2', ['1'], ['999']))).toBeNull()
  })

  it('refuses a non-NFL trade: FantasyCalc has no market for it', async () => {
    expect(await collectTradeMarketFacts(trade('t3', ['1'], ['2'], { sport: 'nba' }))).toBeNull()
  })
})

describe('runComprehensiveBackgroundAnalysis — the scheduled pass', () => {
  it('values what it can, marks refusals analyzed WITHOUT values, and writes no dynasty field', async () => {
    h.trades = [trade('ok', ['2'], ['3']), trade('unpriced', ['1'], ['999'])]
    const r = await runComprehensiveBackgroundAnalysis({ budgetMs: 60_000 })
    expect(r).toMatchObject({ examined: 2, valued: 1, refused: 1, remaining: 0, error: null })
    const ok = h.updates.find((u) => u.id === 'ok')!.data
    expect(ok).toMatchObject({ analyzed: true, valueGiven: 4000, valueReceived: 4100 })
    expect(ok).not.toHaveProperty('dynastyTierScore')
    expect(h.updates.find((u) => u.id === 'unpriced')!.data).toEqual({ analyzed: true })
  })

  it('stops taking trades once 60% of the budget is spent', async () => {
    h.trades = Array.from({ length: 10 }, (_, i) => trade(`t${i}`, ['2'], ['3']))
    let clock = 0
    // Every clock read advances 10s: the budget runs out part-way through the batch.
    const r = await runComprehensiveBackgroundAnalysis({ budgetMs: 60_000, now: () => (clock += 10_000) })
    expect(r.examined).toBeGreaterThan(0)
    expect(r.examined).toBeLessThan(10)
    expect(r.remaining).toBe(10 - r.examined)
  })

  it('aggregates once the backlog drains, and the AI-facing context carries no dynasty figure', async () => {
    h.trades = Array.from({ length: 6 }, (_, i) => trade(`t${i}`, ['2', '1'], ['3']))
    const r = await runComprehensiveBackgroundAnalysis({ budgetMs: 60_000 })
    expect(r.aggregated).toBe(true)
    expect(h.insights.length).toBeGreaterThan(0)
    for (const i of h.insights) expect(String(i.insightText)).not.toMatch(/dynasty/i)
    h.insights = h.insights.map((i) => ({ ...i, sampleSize: 9, confidenceScore: 1 }))
    const context = await getComprehensiveLearningContext()
    expect(context).toMatch(/avg market value/)
    expect(context).toMatch(/avg value gap between sides \d+%/)
    expect(context).not.toMatch(/dynasty|fair/i)
  })

  it('does not re-aggregate within 6h while the backlog is still draining', async () => {
    h.stats.set(0, { id: 's0', season: 0, lastUpdated: new Date(), createdAt: new Date() })
    h.trades = Array.from({ length: 4 }, (_, i) => trade(`t${i}`, ['2'], ['3']))
    const r = await runComprehensiveBackgroundAnalysis({ budgetMs: 60_000, batchSize: 2 })
    expect(r).toMatchObject({ valued: 2, remaining: 2, aggregated: false })
    expect(r.aggregateSkipped).toMatch(/within the last 6h/)
  })
})

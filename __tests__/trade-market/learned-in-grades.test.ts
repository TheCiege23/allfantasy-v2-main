import { describe, expect, it } from 'vitest'

import {
  booksOf,
  learnedNeedOn,
  learnedNeedPremium,
  learnedPickAdjustment,
  learnedPicksOn,
  learnedPostureAdjustment,
  learnedPostureOn,
  loadLearnedTables,
  resetLearnedTablesMemo,
  type LearnedTables,
} from '@/lib/trade-market/learnedInGrades'
import { NEED_MARKET_CACHE_KEY, PICK_MARKET_CACHE_KEY, POSTURE_MARKET_CACHE_KEY, type MarketBook } from '@/lib/trade-market/formatMarkets'
import { buildTradeMarketOverlay } from '@/lib/trade-value-console/tradeMarketOverlay'
import { gradeOnLeagueValue } from '@/lib/trade-value-console/leagueGrade'
import { allocateNeedFactors, type NeedLine } from '@/lib/trade-value/viewerNeedFactors'
import { computeRosterNeed, readSlotRequirements } from '@/lib/trade-intel/rosterNeed'
import type { ScarcityBoard } from '@/lib/trade-intel/positionScarcity'
import type { PricedAsset } from '@/lib/hybrid-valuation'
import type { TradeConsolePlayerLine } from '@/lib/trade-value-console/types'

/**
 * The learned tables in the grades (owner's call, 2026-11-22): each learner behind its own switch, all OFF, so switching
 * one on is a single decision made on what the daily runs show. Nothing unpublished, stale or switched off moves a grade.
 */

const NOW = new Date('2026-11-22T12:00:00Z')
const BOOK = 'DYNASTY:SUPERFLEX'
const SF: MarketBook = { format: 'DYNASTY', qbFormat: 'SUPERFLEX' }

const tables = (over: Partial<LearnedTables> = {}): LearnedTables => ({
  // Next draft (2027) first-rounders: the curve says 4000, completed trades paid 4600.
  picks: new Map([[BOOK, [
    { key: '1:0', published: true, value: 4600, prior: 4000, trades: 88 },
    { key: '2:0', published: false, value: 2500, prior: 2000, trades: 9 },
  ] as never]]),
  need: new Map([[BOOK, [
    { position: 'TE', need: 'short', published: true, premiumPct: 11, trades: 140 },
    { position: 'WR', need: 'short', published: false, premiumPct: 20, trades: 12 },
    { position: 'TE', need: 'short_this_week', published: true, premiumPct: 14, trades: 60 },
  ] as never]]),
  posture: new Map([[BOOK, [
    { buyer: 'contend', bought: 'veteran', published: true, premiumPct: 8, trades: 210 },
    { buyer: 'contend', bought: 'picks', published: true, premiumPct: -6, trades: 150 },
    { buyer: 'rebuild', bought: 'youth', published: false, premiumPct: 9, trades: 20 },
  ] as never]]),
  ...over,
})

describe('the switches', () => {
  it('all off by default; only "on" turns one on, and each is its own', () => {
    expect([learnedPicksOn({}), learnedNeedOn({}), learnedPostureOn({})]).toEqual([false, false, false])
    expect(learnedPicksOn({ TRADE_LEARNED_PICKS: 'true' })).toBe(false)
    expect(learnedPicksOn({ TRADE_LEARNED_PICKS: ' ON ' })).toBe(true)
    expect(learnedNeedOn({ TRADE_LEARNED_PICKS: 'on' })).toBe(false)
    expect(learnedPostureOn({ TRADE_LEARNED_POSTURE: 'on' })).toBe(true)
  })
})

describe('reading the stored tables', () => {
  const doc = (generatedAt: string) => ({ generatedAt, books: [{ book: BOOK, classes: [{ key: '1:0' }] }] })

  it('a table older than three weeks is not a market; an unreadable one is empty', () => {
    expect(booksOf(doc('2026-11-20T00:00:00Z'), 'classes', NOW).get(BOOK)).toHaveLength(1)
    expect(booksOf(doc('2026-10-20T00:00:00Z'), 'classes', NOW).size).toBe(0)
    expect(booksOf(null, 'classes', NOW).size).toBe(0)
    expect(booksOf({ generatedAt: 'nope', books: [] }, 'classes', NOW).size).toBe(0)
  })

  it('reads the three cache keys once per ten minutes, and a failed read is an empty table', async () => {
    resetLearnedTablesMemo()
    const asked: string[] = []
    const prisma = {
      sportsDataCache: {
        findUnique: async ({ where }: { where: { cacheKey: string } }) => {
          asked.push(where.cacheKey)
          if (where.cacheKey === NEED_MARKET_CACHE_KEY) throw new Error('down')
          return { data: { generatedAt: '2026-11-21T00:00:00Z', books: [{ book: BOOK, classes: [{ key: '1:0' }], premiums: [{ buyer: 'contend' }] }] } }
        },
      },
    }
    const t = await loadLearnedTables(prisma, NOW)
    expect(asked.sort()).toEqual([NEED_MARKET_CACHE_KEY, PICK_MARKET_CACHE_KEY, POSTURE_MARKET_CACHE_KEY].sort())
    expect(t.picks.get(BOOK)).toHaveLength(1)
    expect(t.need.size).toBe(0)
    await loadLearnedTables(prisma, new Date(NOW.getTime() + 60_000))
    expect(asked).toHaveLength(3)
    await loadLearnedTables(prisma, new Date(NOW.getTime() + 11 * 60_000))
    expect(asked).toHaveLength(6)
    resetLearnedTablesMemo()
  })
})

describe('a learned pick value', () => {
  it('a published class moves the pick by value ÷ curve, and says what it was measured on', () => {
    const a = learnedPickAdjustment(tables(), BOOK, '2027 1st', 12, NOW)!
    expect(a.kind).toBe('tradeMarket')
    expect(a.factor).toBeCloseTo(1.15, 6)
    expect(a.reason).toMatch(/\+15%.*next draft.*88 completed trades/)
  })

  it('nothing for an unpublished class, another book, a past draft or an unreadable label', () => {
    expect(learnedPickAdjustment(tables(), BOOK, '2027 2nd', 12, NOW)).toBeNull()
    expect(learnedPickAdjustment(tables(), 'DYNASTY:ONE_QB', '2027 1st', 12, NOW)).toBeNull()
    expect(learnedPickAdjustment(tables(), BOOK, '2026 1st', 12, NOW)).toBeNull()
    expect(learnedPickAdjustment(tables(), BOOK, 'a pick', 12, NOW)).toBeNull()
  })
})

describe('the league-value grade with learned picks', () => {
  const line = (over: Partial<TradeConsolePlayerLine> = {}): TradeConsolePlayerLine =>
    ({
      name: '2027 1st', playerId: null, enrichmentPlayerId: null, sport: 'NFL', position: 'PICK', team: null, headshotUrl: null,
      logoUrl: null, injuryStatus: null, dataSource: 'sleeper', composite: 0, marketValue: 4000, pricedSource: 'pick', ...over,
    }) as TradeConsolePlayerLine
  const priced = (marketValue: number): PricedAsset =>
    ({ name: 'x', type: 'pick', value: marketValue, source: 'pick', assetValue: { marketValue, impactValue: 0, vorpValue: 0, volatility: 0 } }) as unknown as PricedAsset
  const player = line({ name: 'A Player', playerId: 'NFL:9', enrichmentPlayerId: '9', position: 'WR', pricedSource: 'fantasycalc' })

  const overlayWith = (learned: LearnedTables | null) =>
    buildTradeMarketOverlay({ giveLines: [line()], getLines: [player], givePriced: [priced(4000)], getPriced: [priced(4000)], rows: new Map(), book: SF, learned, teams: 12, now: NOW })

  it('the pick is priced on what completed trades paid, and the grade says so', () => {
    const o = overlayWith(tables())!
    expect(o.learnedPicks.give[0]?.factor).toBeCloseTo(1.15, 6)
    expect(o.learnedPicks.get[0]).toBeNull()
    const g = gradeOnLeagueValue({
      giveLines: [line()], getLines: [player], givePriced: [priced(4000)], getPriced: [priced(4000)], league: null,
      chart: { dynasty: true, superflex: true, teams: 12, ppr: 1 }, needFactors: null, learnedPicks: o.learnedPicks,
    })
    expect(g.totals.giveLeague).toBe(4600)
    expect(g.totals.getLeague).toBe(4000)
  })

  it('switched off (no tables), the pick stays exactly as priced', () => {
    const o = overlayWith(null)
    expect(o?.learnedPicks.give[0] ?? null).toBeNull()
  })

  it('🛑 a learned pick move on a PLAYER line is never applied', () => {
    const g = gradeOnLeagueValue({
      giveLines: [player], getLines: [line()], givePriced: [priced(4000)], getPriced: [priced(4000)], league: null,
      chart: { dynasty: true, superflex: true, teams: 12, ppr: 1 }, needFactors: null,
      learnedPicks: { give: [{ kind: 'tradeMarket', factor: 1.5, reason: 'x' }], get: [null] },
    })
    expect(g.totals.giveLeague).toBe(4000)
  })
})

describe('need and posture, on your team', () => {
  const requirements = readSlotRequirements(['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'BN'])!
  const needOf = (positions: string[]) => computeRosterNeed({ requirements, rostered: positions })
  const wire: ScarcityBoard = new Map([['TE', { position: 'TE', freeAgents: 0, scarcity: 1 }], ['WR', { position: 'WR', freeAgents: 0, scarcity: 1 }]])
  const line = (name: string, position: string | null, base: number, over: Partial<NeedLine> = {}): NeedLine => ({ name, position, base, ...over })
  const noTe = needOf(['QB', 'RB', 'RB', 'WR', 'WR'])
  const full = needOf(['QB', 'RB', 'RB', 'WR', 'WR', 'TE'])

  const run = (get: NeedLine[], learned: Parameters<typeof allocateNeedFactors>[0]['learned'], before = noTe) =>
    allocateNeedFactors({ give: [], get, needAfterOutgoing: before, needAfterTrade: full, scarcity: wire, learned })

  it('learned need on: an open TE slot takes the premium teams short at TE paid, not the hand-set one', () => {
    const hand = run([line('A TE', 'TE', 4000)], null).get[0]!
    const learned = run([line('A TE', 'TE', 4000)], { book: BOOK, tables: tables(), need: true, posture: null }).get[0]!
    expect(learned.factor).toBeCloseTo(1.11, 6)
    expect(learned.factor).not.toBeCloseTo(hand.factor, 3)
    expect(learned.reason).toMatch(/teams short at TE paid \+11% over normal-depth teams across 140 completed trades/)
    // The same tables with the switch off change nothing.
    expect(run([line('A TE', 'TE', 4000)], { book: BOOK, tables: tables(), need: false, posture: null }).get[0]).toEqual(hand)
  })

  it('the hole is a ruled-out starter (depth is fine): the "short this week" premium, said so', () => {
    const learned = { book: BOOK, tables: tables(), need: true, posture: null }
    // Now: no TE available. Depth (everyone counted as available): a TE on the roster.
    const out = allocateNeedFactors({ give: [], get: [line('A TE', 'TE', 4000)], needAfterOutgoing: noTe, needAfterTrade: full, scarcity: wire, learned, depthAfterOutgoing: full }).get[0]!
    expect(out.factor).toBeCloseTo(1.14, 6)
    expect(out.reason).toMatch(/teams short at TE this week \(a starter ruled out\) paid \+14%.*60 completed trades/)
    // Missing depth as well: the plain "short" premium.
    const deep = allocateNeedFactors({ give: [], get: [line('A TE', 'TE', 4000)], needAfterOutgoing: noTe, needAfterTrade: full, scarcity: wire, learned, depthAfterOutgoing: noTe }).get[0]!
    expect(deep.factor).toBeCloseTo(1.11, 6)
    expect(deep.reason).not.toMatch(/this week/)
  })

  it('an unpublished need premium, or a position with none, keeps the hand-set factor', () => {
    const shortWr = needOf(['QB', 'RB', 'RB', 'WR', 'TE'])
    const hand = run([line('A WR', 'WR', 4000)], null, shortWr).get[0]!
    expect(run([line('A WR', 'WR', 4000)], { book: BOOK, tables: tables(), need: true, posture: null }, shortWr).get[0]).toEqual(hand)
  })

  it('learned posture on, as a contender: a veteran you take on costs more, a pick less; youth and unknown ages untouched', () => {
    const ages = new Map<string, number | null>([['vet', 29], ['kid', 22], ['mid', 25]])
    const learned = { book: BOOK, tables: tables(), need: false, posture: 'contend' as const, ages }
    const out = run(
      [line('Vet', 'RB', 3000, { sleeperId: 'vet' }), line('Kid', 'RB', 3000, { sleeperId: 'kid' }), line('Mid', 'RB', 3000, { sleeperId: 'mid' }), line('Nobody', 'RB', 3000, { sleeperId: 'gone' }), line('2027 1st', null, 3000, { isPick: true })],
      learned,
      full,
    ).get
    expect(out[0]!.factor).toBeCloseTo(1.08, 6)
    expect(out[0]!.reason).toMatch(/teams at \.600 or better paid \+8% for players 27 or older/)
    expect(out[1]).toBeNull()
    expect(out[2]).toBeNull()
    expect(out[3]).toBeNull()
    expect(out[4]!.factor).toBeCloseTo(0.94, 6)
    // Only what you take on: the lines you give are never moved by your posture.
    const giving = allocateNeedFactors({ give: [line('Vet', 'RB', 3000, { sleeperId: 'vet' })], get: [], needAfterOutgoing: full, needAfterTrade: full, scarcity: wire, learned })
    expect(giving.give[0]).toBeNull()
  })

  it('posture on an open-slot line multiplies with the need move and keeps both reasons', () => {
    const out = run([line('Old TE', 'TE', 4000, { sleeperId: 'vet' })], { book: BOOK, tables: tables(), need: true, posture: 'contend', ages: new Map([['vet', 30]]) }).get[0]!
    expect(out.factor).toBeCloseTo(1.11 * 1.08, 6)
    expect(out.reason).toMatch(/teams short at TE.*; teams at \.600 or better/)
  })

  it('a middle team, or an unpublished posture premium, moves nothing', () => {
    const vet = [line('Vet', 'RB', 3000, { sleeperId: 'vet' })]
    const ages = new Map([['vet', 29]])
    expect(run(vet, { book: BOOK, tables: tables(), need: false, posture: 'middle', ages }, full).get[0]).toBeNull()
    expect(learnedPostureAdjustment(tables(), BOOK, 'rebuild', 'youth')).toBeNull()
    expect(learnedNeedPremium(tables(), BOOK, 'te', 'short')).toEqual({ pct: 11, trades: 140 })
  })
})

/* The trade market as evidence for a waiver pickup (2026-11-22): a sentence, never a multiplier. */
describe('trade need evidence, outside a trade', () => {
  it('one sentence per position with a published, positive premium for being short there', async () => {
    const { tradeNeedEvidence } = await import('@/lib/trade-market/learnedInGrades')
    expect(tradeNeedEvidence(tables(), BOOK)).toEqual({ TE: 'In trades, teams short at TE paid +11% over normal-depth teams across 140 completed trades' })
    expect(tradeNeedEvidence(tables(), 'REDRAFT:ONE_QB')).toEqual({})
  })

  it('the waiver "fills a need" line carries it — and the pickup\'s score does not move', async () => {
    const { scoreWaiverCandidates } = await import('@/lib/decision-os/waiver/candidateScoring')
    const candidate = { playerId: 'te9', playerName: 'Free Tight End', position: 'TE', team: 'KC', byeWeek: null, age: 25, value: 1500, assetValue: { impactValue: 600, marketValue: 1500, vorpValue: 300, volatility: 0.2 }, source: 't' }
    const ctx = { goal: 'balanced' as const, needs: ['TE'], surplus: [], isSF: true, isTEP: false, numTeams: 12, isDynasty: true, rosterPlayers: [], teamNeeds: { weakestSlots: [], biggestNeed: null, byeWeekClusters: [], positionalDepth: [], dropCandidates: [] }, currentWeek: 9 }
    const plain = scoreWaiverCandidates([candidate as never], ctx as never, { maxResults: 1 })[0]!
    const cited = scoreWaiverCandidates([candidate as never], { ...ctx, tradeNeedEvidence: { TE: 'In trades, teams short at TE paid +11% over normal-depth teams across 140 completed trades' } } as never, { maxResults: 1 })[0]!
    expect(cited.compositeScore).toBe(plain.compositeScore)
    expect(JSON.stringify(cited)).toContain('teams short at TE paid +11%')
    expect(JSON.stringify(plain)).not.toContain('In trades')
    // The evidence also arrives riding on the needs themselves — the path the engine input uses.
    const viaNeeds = scoreWaiverCandidates([candidate as never], { ...ctx, teamNeeds: { ...ctx.teamNeeds, tradeNeedEvidence: { TE: 'In trades, teams short at TE paid +11% over normal-depth teams across 140 completed trades' } } } as never, { maxResults: 1 })[0]!
    expect(JSON.stringify(viaNeeds)).toContain('teams short at TE paid +11%')
    // A pickup at a position that is not a need does not cite it.
    const wr = scoreWaiverCandidates([{ ...candidate, position: 'WR' } as never], { ...ctx, tradeNeedEvidence: { WR: 'x across 9 completed trades' } } as never, { maxResults: 1 })[0]!
    expect(JSON.stringify(wr)).not.toContain('x across 9')
  })
})

describe('trade need evidence, end to end through the waiver engine input', () => {
  it('waiverEngineInputFrom → the engine: the pickup that fills the need cites the trade market', async () => {
    const { waiverEngineInputFrom } = await import('@/lib/decision-os/waiver/engineInput')
    const { suggestWaiverPickups } = await import('@/lib/waiver-ai-engine/suggest')
    const sentence = 'In trades, teams short at TE paid +11% over normal-depth teams across 140 completed trades'
    const teamNeeds = { weakestSlots: [{ slot: 'TE', position: 'TE', currentValue: 500, leagueMedianValue: 2000, gap: 1500, gapPpg: 3.1 }], biggestNeed: null, byeWeekClusters: [], positionalDepth: [], dropCandidates: [] }
    const pool = {
      availablePlayers: [{ playerId: 'te9', playerName: 'Free Tight End', position: 'TE', team: 'KC', byeWeek: null, age: 25, value: 1500, assetValue: { impactValue: 600, marketValue: 1500, vorpValue: 300, volatility: 0.2 }, source: 't' }],
      myRoster: [], leagueRosters: [], rosterPositions: ['QB', 'TE'], leagueTraits: { numTeams: 12, isSF: true, isTEP: false, isDynasty: true },
      currentWeek: 9, teamNeeds, tradeNeedEvidence: { TE: sentence },
    }
    const facts = { sport: 'NFL', settings: { faabBudget: 100 }, faabRemaining: 60 }
    const withIt = suggestWaiverPickups(waiverEngineInputFrom(facts as never, pool as never) as never)
    expect(JSON.stringify(withIt.suggestions[0])).toContain(sentence)
    const without = suggestWaiverPickups(waiverEngineInputFrom(facts as never, { ...pool, tradeNeedEvidence: undefined } as never) as never)
    expect(JSON.stringify(without.suggestions[0])).not.toContain('In trades')
    expect(withIt.suggestions[0]!.compositeScore).toBe(without.suggestions[0]!.compositeScore)
  })
})

/**
 * 🛑 A COMPLETED TRADE'S FROZEN ORIGINAL IS PRICED AT THE TIME OF THE TRADE (Guap's ruling, 2026-10-03).
 *
 * End to end through the ONE grader — real `createLeagueTradeGrader`, real `resolveAssets`, real
 * `pricePlayer` and `gradeTrade` — with only the data layer stubbed: the league row, TODAY's chart,
 * TODAY's defender/kicker board, and the stored captures (`PlayerValueSnapshot`).
 *
 * The rule under test is "one date, one scale, or nothing": every asset priced from the trade-day
 * capture, or the whole trade keeps its first-graded original. Each mixing attempt below is a way a
 * single asset could have been priced from today's chart, today's league board, or the historical
 * file while the rest of the trade was priced on its date — and each must send the trade back.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  today: [] as unknown[],
  captures: new Map<string, unknown[]>(),
  kickerOnTodaysBoard: true,
  table: [] as Array<{ leagueId: string; sleeperUsername: string; snapshotType: string; contextKey: string | null; payloadJson: unknown; createdAt: Date }>,
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    playerValueSnapshot: {
      // "Listed on another chart" evidence and the real dated loader both read here.
      findMany: vi.fn(async ({ where }: { where: { capturedAt?: Date | { gte: Date } ; format?: string } }) => {
        if (where.capturedAt instanceof Date) return (h.captures.get(where.capturedAt.toISOString().slice(0, 10)) ?? []) as never
        return []
      }),
    },
    $queryRaw: vi.fn(async () => [...h.captures.keys()].map((day) => ({ day }))),
    playerAnalyticsSnapshot: { findFirst: vi.fn(async () => null) },
    tradeAnalysisSnapshot: {
      findMany: vi.fn(async ({ where }: { where: { leagueId: string; sleeperUsername: string; snapshotType: string; contextKey: { in: string[] } } }) =>
        h.table
          .filter((r) => r.leagueId === where.leagueId && r.sleeperUsername === where.sleeperUsername
            && r.snapshotType === where.snapshotType && where.contextKey.in.includes(r.contextKey ?? ''))
          .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())),
      createMany: vi.fn(async ({ data }: { data: Array<Omit<(typeof h.table)[number], 'createdAt'>> }) => {
        for (const d of data) h.table.push({ ...d, createdAt: new Date(Date.UTC(2026, 9, 3) + h.table.length) })
        return { count: data.length }
      }),
    },
  },
}))
vi.mock('@/lib/trade-value-console/league-loader', () => ({
  loadLeagueForTrade: async ({ leagueId }: { leagueId: string }) => ({
    id: leagueId,
    platformLeagueId: 'sl-1',
    name: 'Dynasty for life',
    sport: 'NFL',
    leagueSize: 12,
    isDynasty: true,
    leagueType: 'dynasty',
    scoring: 'ppr',
    settings: { scoring_settings: { rec: 1 }, roster_positions: ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'K', 'BN'] },
    waiverBudget: 100,
    taxiSlots: 0,
    leagueVariant: 'dynasty',
    bestBallMode: false,
    starters: ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'K'],
  }),
}))
vi.mock('@/lib/league-context-engine', () => ({ resolveNormalizedLeagueContext: async () => ({ ok: false }) }))
vi.mock('@/lib/fantasycalc-db', () => ({
  getFantasyCalcValuesDbFirst: async () => h.today,
  getFantasyCalcChartDbFirst: async () => ({ players: h.today, syncedAt: '2026-10-03T09:00:00.000Z' }),
}))
// TODAY's defender/kicker board — the one source with no dated history.
vi.mock('@/lib/league-values/leagueTradeValues', () => ({
  loadLeagueTradeValues: async () => h.kickerOnTodaysBoard
    ? {
        byNameLower: new Map([['the kicker', { sleeperId: '9003', value: 900, position: 'K', basis: 'kicker-flat' }]]),
        bySleeperId: new Map([['9003', { sleeperId: '9003', value: 900, position: 'K', basis: 'kicker-flat' }]]),
        unpricedReasonBySleeperId: new Map(),
        unpricedReasonByNameLower: new Map(),
      }
    : null,
}))
vi.mock('@/lib/data/players', () => ({ getPlayer: async () => null, searchPlayers: async () => [] }))
vi.mock('@/lib/shared-services/player-identity/PlayerIdentityResolver', () => ({ resolvePlayer: async () => ({ confidence: 'none' }) }))
vi.mock('@/lib/core-app/archivedPickOutcomes', () => ({
  ledgerKey: (league: string, tx: string) => `${league}:${tx}`,
  loadLedgerSidesForTrades: vi.fn(async () => new Map()),
}))

import { fantasyCalcPlayerFromSnapshot, clearDatedMarketMemo, loadCaptureDays, loadDatedMarket } from '@/lib/decision-os/trade/datedMarket'
import { createLeagueTradeGrader, type LeagueTradeGrader } from '@/lib/decision-os/trade/leagueTradeGrader'
import { withDatedMarket } from '@/lib/trade-value-console/leagueTradePricing'
import { gradeAtTradeTime, oneGradeForCompletedTrade, completedTradeInputs } from '@/lib/decision-os/trade/completedTradeGrade'
import { sleeperPlayerInput } from '@/lib/decision-os/trade/completedTradeGrade'
import type { GradeInputs } from '@/lib/decision-os/trade/tradeGradeInputs'
import { gradeMoment } from '@/lib/decision-os/trade/gradeMoment'
import type { GradedTrade } from '@/lib/trade-intel/sleeperTradeGradeService'
import { gradeArchivedTradeRows } from '@/lib/core-app/archivedTradeGrade'
import { gradeProviderCompletedTrades } from '@/lib/provider-trades/providerCompletedGrades'
import { saveFrozenCompletedGrades, type FrozenCompletedGrade } from '@/lib/decision-os/trade/frozenCompletedGrade'

/** A stored `PlayerValueSnapshot` row, as the dated loader reads it. */
const snap = (sleeperId: string, name: string, position: string, value: number) =>
  ({ sleeperId, name, position, value, overallRank: null, positionRank: null, trend30d: null, tradeFrequency: null, marketStdDev: null })
/** A row on TODAY's chart. */
const row = (sleeperId: string, name: string, position: string, value: number) => fantasyCalcPlayerFromSnapshot(snap(sleeperId, name, position, value))

const PUKA = { id: '9001', name: 'Puka Nacua', pos: 'WR' }
const DRAKE = { id: '9002', name: 'Drake London', pos: 'WR' }
const KICKER = { id: '9003', name: 'The Kicker', pos: 'K' }
const ROOKIE = { id: '9004', name: 'Drafted Rookie', pos: 'WR' }

/** The trade: side one sends Puka; receives Drake and a 2027 1st. 15:00 UTC on Sep 24 → capture Sep 24. */
const TRADE_AT = '2026-09-24T15:00:00.000Z'
/** A Sleeper snowflake whose own timestamp is TRADE_AT — what dates a trade when no completion time is at hand. */
const TX_ID = '1408864577436778496'

beforeEach(() => {
  clearDatedMarketMemo()
  h.table.length = 0
  h.kickerOnTodaysBoard = true
  // TODAY: Puka fell, Drake rose, picks fell — on this chart side one wins by more than 25%: an A.
  h.today = [row(PUKA.id, PUKA.name, 'WR', 5000), row(DRAKE.id, DRAKE.name, 'WR', 6000), row('FP_2027_1', '2027 1st', 'PICK', 1000), row(ROOKIE.id, ROOKIE.name, 'WR', 2500)]
  // THE TRADE DATE: 6000 out, 4500 + 3000 in — +20%, a B.
  h.captures = new Map([
    ['2026-09-23', [snap(PUKA.id, PUKA.name, 'WR', 6100), snap(DRAKE.id, DRAKE.name, 'WR', 4400), snap('FP_2027_1', '2027 1st', 'PICK', 3000)]],
    ['2026-09-24', [snap(PUKA.id, PUKA.name, 'WR', 6000), snap(DRAKE.id, DRAKE.name, 'WR', 4500), snap('FP_2027_1', '2027 1st', 'PICK', 3000)]],
    // Before 2026-09-20 no pick rows were stored.
    ['2026-09-10', [snap(PUKA.id, PUKA.name, 'WR', 6000), snap(DRAKE.id, DRAKE.name, 'WR', 4500)]],
  ])
})

const p = (x: { id: string; name: string; pos: string }) => sleeperPlayerInput(x.name, x.id, x.pos)
const side = (assets: GradeInputs['assets'], unpriceable: string[] = []): GradeInputs => ({ assets, unpriceable })
const DEAL = { give: side([p(PUKA)]), get: side([p(DRAKE), { kind: 'pick', year: 2027, round: 1 }]) }

let n = 0
const grader = async () => (await createLeagueTradeGrader({ leagueId: `L-${++n}` }))!
const at = (iso: string) => new Date(iso)

describe('pricing a completed trade on its own date — through the one grader', () => {
  it('🛑 the trade-date letter differs from today’s when the market moved in between', async () => {
    const g = await grader()
    const today = await g.grade({ give: DEAL.give.assets, get: DEAL.get.assets, viewerSide: false })
    const dated = await gradeAtTradeTime(g, DEAL, at(TRADE_AT))
    if (!today.graded || !dated) throw new Error('expected both grades')
    expect([today.giveValue, today.getValue, today.letter]).toEqual([5000, 7000, 'A'])
    expect([dated.grade.giveValue, dated.grade.getValue, dated.grade.letter]).toEqual([6000, 7500, 'B'])
    expect(dated.pricedAsOf).toBe('2026-09-24')
    // Every line is that day's evidence, dated that day.
    expect(dated.grade.lines.map((l) => [l.valueSource, l.valueAsOf])).toEqual([
      ['fantasycalc', '2026-09-24T00:00:00.000Z'],
      ['fantasycalc', '2026-09-24T00:00:00.000Z'],
      ['fantasycalc_pick', '2026-09-24T00:00:00.000Z'],
    ])
  })

  it('reads the real stored captures (`loadCaptureDays` / `loadDatedMarket`)', async () => {
    const book = { format: 'DYNASTY' as const, qbFormat: 'ONE_QB' as const }
    expect((await loadCaptureDays(book)).sort()).toEqual(['2026-09-10', '2026-09-23', '2026-09-24'])
    const m = await loadDatedMarket(book, '2026-09-24')
    expect(m?.players.map((x) => [x.player.sleeperId, x.value])).toEqual([[PUKA.id, 6000], [DRAKE.id, 4500], ['FP_2027_1', 3000]])
    expect(await loadDatedMarket(book, '2026-09-25')).toBeNull()
  })

  describe('🛑 one date, one scale — every attempt to mix in another source sends the whole trade back', () => {
    it('a player missing from the trade-day capture is NOT filled in from today’s chart', async () => {
      const g = await grader()
      const deal = { give: DEAL.give, get: side([p(DRAKE), p(ROOKIE)]) } // the rookie is on today's chart only
      const today = await g.grade({ give: deal.give.assets, get: deal.get.assets, viewerSide: false })
      expect(today.graded).toBe(true)
      expect(await gradeAtTradeTime(g, deal, at(TRADE_AT))).toBeNull()
    })

    it('a kicker priced by TODAY’s league board is not priced at all on the trade date', async () => {
      const g = await grader()
      const deal = { give: side([p(PUKA)]), get: side([p(DRAKE), p(KICKER)]) }
      const today = await g.grade({ give: deal.give.assets, get: deal.get.assets, viewerSide: false })
      if (!today.graded) throw new Error(today.reason)
      expect(today.lines.find((l) => l.name === KICKER.name)?.valueSource).toBe('league_kicker')
      expect(await gradeAtTradeTime(g, deal, at(TRADE_AT))).toBeNull()
    })

    it('a player named but without a Sleeper id is never name-joined onto the capture', async () => {
      const g = await grader()
      const deal = { give: side([{ kind: 'player', name: PUKA.name }]), get: DEAL.get }
      expect(await gradeAtTradeTime(g, deal, at(TRADE_AT))).toBeNull()
    })

    it('an asset the caller could not describe (an unresolvable pick) sends it back', async () => {
      const g = await grader()
      expect(await gradeAtTradeTime(g, { give: DEAL.give, get: side(DEAL.get.assets, ['a pick with no season']) }, at(TRADE_AT))).toBeNull()
    })

    it('a pick traded before 2026-09-20 has no stored pick row — unpriced on that date, never today’s pick price', async () => {
      const g = await grader()
      expect(await gradeAtTradeTime(g, DEAL, at('2026-09-10T18:00:00.000Z'))).toBeNull()
      // The same trade without the pick prices on Sep 10 fine — it is the pick that has no record.
      const noPick = { give: DEAL.give, get: side([p(DRAKE)]) }
      expect((await gradeAtTradeTime(g, noPick, at('2026-09-10T18:00:00.000Z')))?.pricedAsOf).toBe('2026-09-10')
    })

    it('a pick traded after 2026-09-20 is priced AS THE PICK from that capture’s pick rows', async () => {
      const g = await grader()
      const dated = await gradeAtTradeTime(g, DEAL, at(TRADE_AT))
      expect(dated?.grade.lines.find((l) => l.assetKind === 'pick')).toMatchObject({ marketValue: 3000, valueSource: 'fantasycalc_pick' })
    })

    it('a line from any source but the capture (e.g. a historical-file price) fails the purity check', async () => {
      const g = await grader()
      // A doctored dated grader whose grade carries one line priced from the historical file.
      const doctored: LeagueTradeGrader = {
        ...g,
        atMarket: (m) => {
          const real = g.atMarket!(m)
          return {
            ...real,
            async grade(deal) {
              const v = await real.grade(deal)
              // Dated like the rest — only its SOURCE gives it away.
              return v.graded ? { ...v, lines: v.lines.map((l, i) => (i === 0 ? { ...l, valueSource: 'historical_file' as const } : l)) } : v
            },
          }
        },
      }
      expect(await gradeAtTradeTime(doctored, DEAL, at(TRADE_AT))).toBeNull()
    })
  })
})

describe('the dated chart (`withDatedMarket`)', () => {
  it('keeps the league, replaces the market, and DROPS today’s defender/kicker board — with asOfDate still today', async () => {
    const g = await grader()
    expect(g.chart.nflCtx.leagueValueBySleeperId?.size).toBe(1) // today's board is loaded…
    const market = (await loadDatedMarket(g.book!, '2026-09-24'))!
    const dated = withDatedMarket(g.chart, market)
    expect(dated.nflCtx.leagueValueBySleeperId).toBeUndefined() // …and gone from the dated chart
    expect(dated.nflCtx.leagueValueByNameLower).toBeUndefined()
    expect(dated.nflCtx.leagueUnpricedReasonBySleeperId).toBeUndefined()
    expect(dated.fcPlayers).toBe(market.players)
    expect(dated.nflCtx.fantasyCalcPlayers).toBe(market.players)
    // A past asOfDate would route `pricePlayer` to the historical JSON — it must stay today's.
    expect(dated.nflCtx.asOfDate).toBe(g.chart.nflCtx.asOfDate)
    expect([dated.chartIsDynasty, dated.isSuperFlex, dated.pprNfl, dated.leagueSize]).toEqual([g.chart.chartIsDynasty, g.chart.isSuperFlex, g.chart.pprNfl, g.chart.leagueSize])
  })
})

describe('the capture rule, through the grader', () => {
  it('a trade before 10:00 UTC on D is priced on capture D-1; after, on capture D', async () => {
    const g = await grader()
    expect((await gradeAtTradeTime(g, DEAL, at('2026-09-24T09:59:00.000Z')))?.pricedAsOf).toBe('2026-09-23')
    expect((await gradeAtTradeTime(g, DEAL, at('2026-09-24T10:00:00.000Z')))?.pricedAsOf).toBe('2026-09-24')
  })

  it('more than a day after the last capture (a gap in the series) is not covered', async () => {
    const g = await grader()
    expect(await gradeAtTradeTime(g, DEAL, at('2026-09-25T10:00:00.000Z'))).toMatchObject({ pricedAsOf: '2026-09-24' })
    expect(await gradeAtTradeTime(g, DEAL, at('2026-09-25T10:00:01.000Z'))).toBeNull()
    // And never a capture taken after the trade, however close.
    expect(await gradeAtTradeTime(g, DEAL, at('2026-09-23T09:59:59.000Z'))).toBeNull()
  })
})

const ledgerTrade = (picksIn: unknown[] = [{ season: '2027', round: 1, originalRosterId: 2, label: '2027 round 1', resolved: null, pending: true, rerouted: false }]) => ({
  id: `sl-1:${TX_ID}`, season: '2026', week: 3, createdIso: TRADE_AT, multiTeam: false, tie: false, hasPendingPicks: true,
  sides: [
    { rosterId: 1, managerName: 'A', playersIn: [{ playerId: DRAKE.id, name: DRAKE.name, position: 'WR' }], playersOut: [{ playerId: PUKA.id, name: PUKA.name, position: 'WR' }], picksIn, picksOut: [] },
    { rosterId: 2, managerName: 'B', playersIn: [{ playerId: PUKA.id, name: PUKA.name, position: 'WR' }], playersOut: [{ playerId: DRAKE.id, name: DRAKE.name, position: 'WR' }], picksIn: [], picksOut: picksIn },
  ],
}) as unknown as GradedTrade

const NOW = new Date('2026-10-03T16:00:00.000Z')
const V1 = 'completed_trade_grade_v1'
const V2 = 'completed_trade_grade_v2'

describe('the frozen original (v2)', () => {
  it('🛑 a first read freezes the TRADE-DATE letter, with today’s beside it', async () => {
    const league = `L-${++n}`
    const view = await oneGradeForCompletedTrade(league, ledgerTrade(), 2026, { now: NOW })
    if (!view.graded) throw new Error(view.reason)
    expect(view.letter).toBe('B')
    expect(view.current).toMatchObject({ letter: 'A', giveValue: 5000, getValue: 7000 })
    expect(view).toMatchObject({ frozenBasis: 'trade_date', pricedAsOf: '2026-09-24', tradeAt: TRADE_AT, frozenAt: NOW.toISOString() })
    expect(h.table).toHaveLength(1)
    expect(h.table[0]).toMatchObject({ snapshotType: V2, contextKey: TX_ID })
    expect(h.table[0]!.payloadJson).toMatchObject({ v: 2, basis: 'trade_date', pricedAsOf: '2026-09-24', tradeAt: TRADE_AT, grade: { letter: 'B' } })
    expect(gradeMoment(view)).toBe('at the time of the trade (Sep 24)')
    // A second read returns the stored original and writes nothing.
    const again = await oneGradeForCompletedTrade(league, ledgerTrade(), 2026, { now: NOW })
    expect(again.graded && again.letter).toBe('B')
    expect(h.table).toHaveLength(1)
  })

  it('a trade that cannot be priced on its date keeps the first-graded letter, labelled honestly', async () => {
    const league = `L-${++n}`
    // Traded on Sep 18: no capture within a day before it (Sep 10 is the last), so not coverable.
    const t = { ...ledgerTrade(), createdIso: '2026-09-18T15:00:00.000Z' } as GradedTrade
    const view = await oneGradeForCompletedTrade(league, t, 2026, { now: NOW })
    if (!view.graded) throw new Error(view.reason)
    expect(view.letter).toBe('A') // today's grade, as v1 froze it
    expect(view).toMatchObject({ frozenBasis: 'first_graded', pricedAsOf: NOW.toISOString(), current: null })
    expect(h.table[0]!.payloadJson).toMatchObject({ v: 2, basis: 'first_graded', pricedAsOf: NOW.toISOString() })
    expect(gradeMoment(view)).toBe('from Oct 3, 2026, 15 days after the trade (no market record from the trade date)')
    expect(gradeMoment(view, 'es')).toBe('del 3 oct 2026, 15 días después del traspaso (no hay registro del mercado de la fecha del traspaso)')
  })

  it('a pick drafted since: the original prices the PICK on the trade date; today’s line prices the player', async () => {
    const league = `L-${++n}`
    const used = [{ season: '2027', round: 1, originalRosterId: 2, label: '2027 round 1', resolved: { playerId: ROOKIE.id, name: ROOKIE.name, position: 'WR', creditedBySeason: {}, departed: null }, pending: false, rerouted: false }]
    const t = ledgerTrade(used)
    expect(completedTradeInputs(t, 2026)!.get.assets).toContainEqual(expect.objectContaining({ providerIdentity: expect.objectContaining({ id: ROOKIE.id }) }))
    const view = await oneGradeForCompletedTrade(league, t, 2026, { now: NOW })
    if (!view.graded) throw new Error(view.reason)
    expect(view).toMatchObject({ letter: 'B', frozenBasis: 'trade_date', getValue: 7500 }) // Drake 4500 + the 1st at 3000
    expect(view.current).toMatchObject({ getValue: 8500 }) // Drake 6000 + the rookie at 2500, today
  })

  it('the batch path (history: originals preloaded, one insert) freezes on the trade date too', async () => {
    const league = `L-${++n}`
    const toFreeze: FrozenCompletedGrade[] = []
    const view = await oneGradeForCompletedTrade(league, ledgerTrade(), 2026, { now: NOW, frozen: new Map(), onFreeze: (f) => toFreeze.push(f) })
    expect(view).toMatchObject({ letter: 'B', frozenBasis: 'trade_date' })
    expect(toFreeze).toEqual([expect.objectContaining({ v: 2, basis: 'trade_date', pricedAsOf: '2026-09-24' })])
    expect(await saveFrozenCompletedGrades(league, toFreeze)).toBe(true)
    expect(h.table[0]).toMatchObject({ snapshotType: V2 })
  })

  it('/core Trades rows (`gradeArchivedTradeRows`): the transaction id dates the trade', async () => {
    const league = `L-${++n}`
    const names: Record<string, string> = { [PUKA.id]: PUKA.name, [DRAKE.id]: DRAKE.name }
    const out = await gradeArchivedTradeRows({
      afLeagueId: league, platformLeagueId: 'sl-1', currentSeason: 2026, nameOf: (id) => names[id] ?? null,
      rows: [{ transactionId: TX_ID, playersGiven: [PUKA.id], playersReceived: [DRAKE.id], picksGiven: [], picksReceived: [{ season: '2027', round: 1 }], partnerRosterId: 2 }],
    })
    expect(out.get(TX_ID)!.grade).toMatchObject({ letter: 'B', frozenBasis: 'trade_date', pricedAsOf: '2026-09-24', tradeAt: TRADE_AT })
    expect(h.table.map((r) => r.snapshotType)).toEqual([V2])
  })

  it('the Trade Center’s provider-completed rows: Sleeper’s completion time dates the trade', async () => {
    const league = `L-${++n}`
    const asset = (x: { id: string; name: string }) => ({ playerId: x.id, playerName: x.name, position: 'WR', team: null, isPick: false, faabAmount: null })
    const trade = {
      transactionId: TX_ID, provider: 'sleeper', lifecycleStatus: 'complete', proposedAt: null,
      // Completed at 09:00 UTC on Sep 24 — before that day's capture — so it is priced on Sep 23's.
      completedAt: '2026-09-24T09:00:00.000Z',
      assetsGiven: [asset(PUKA)],
      assetsReceived: [asset(DRAKE), { playerId: null, playerName: '2027 1st', position: null, team: null, isPick: true, pickYear: 2027, pickRoundNumber: 1, pickRound: '2027 1st', faabAmount: null }],
    }
    const out = await gradeProviderCompletedTrades({ afLeagueId: league, trades: [trade as never], now: NOW })
    expect(out.get(TX_ID)).toMatchObject({ letter: 'B', frozenBasis: 'trade_date', pricedAsOf: '2026-09-23', giveValue: 6100, getValue: 7400 })
  })

  it('🛑 v2 is preferred over v1, and v1 is never touched', async () => {
    const league = `L-${++n}`
    const inputs = completedTradeInputs(ledgerTrade(), 2026)!
    const keys = (s: GradeInputs) => s.assets.map((a) => (a.kind === 'pick' ? `pick:${a.year}:${a.round}` : `sleeper:${a.kind === 'player' ? a.providerIdentity?.id : ''}`)).sort()
    const v1Grade = { graded: true, letter: 'D', partnerLetter: 'B', percentDiff: -12, label: 'x', sideAdvantage: 'opponent', action: 'counter', recommendation: 'x', giveValue: 100, getValue: 88, giveMarket: 100, getMarket: 88, basis: 'b', scoringApplied: true, needApplied: false, needGap: null, lines: [], moves: [] }
    const v1Row = { leagueId: league, sleeperUsername: 'system:completed-trade-grade', snapshotType: V1, contextKey: TX_ID, payloadJson: { v: 1, tradeId: TX_ID, give: keys(inputs.give), get: keys(inputs.get), grade: v1Grade, frozenAt: '2026-09-30T12:00:00.000Z' }, createdAt: new Date('2026-09-30T12:00:00.000Z') }
    h.table.push(v1Row)
    const snapshot = JSON.stringify(h.table)

    // v1 alone: shown as before (legacy wording — nothing has checked its trade date yet), and nothing written.
    const legacy = await oneGradeForCompletedTrade(league, ledgerTrade(), 2026, { now: NOW })
    expect(legacy).toMatchObject({ letter: 'D', frozenBasis: null, frozenAt: '2026-09-30T12:00:00.000Z' })
    expect(gradeMoment(legacy as never)).toBe('when first graded Sep 30')
    expect(JSON.stringify(h.table)).toBe(snapshot)

    // A v2 row lands (the re-price script): every reader now shows it, mirrored for the other side.
    h.table.push({ ...v1Row, snapshotType: V2, payloadJson: { ...v1Row.payloadJson, v: 2, grade: { ...v1Grade, letter: 'B', partnerLetter: 'D', percentDiff: 20 }, frozenAt: NOW.toISOString(), basis: 'trade_date', pricedAsOf: '2026-09-24', tradeAt: TRADE_AT }, createdAt: NOW })
    const before = JSON.stringify(h.table)
    const v2 = await oneGradeForCompletedTrade(league, ledgerTrade(), 2026, { now: NOW })
    expect(v2).toMatchObject({ letter: 'B', frozenBasis: 'trade_date', pricedAsOf: '2026-09-24' })
    expect(JSON.stringify(h.table)).toBe(before) // read-only: the v1 row is exactly as it was
    expect(h.table.find((r) => r.snapshotType === V1)).toEqual(v1Row)
  })
})

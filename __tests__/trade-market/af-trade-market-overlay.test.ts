import { describe, expect, it, vi } from 'vitest'

import {
  AF_MARKET_MAX_AGE_DAYS,
  isApplicableMarketRow,
  loadAfTradeMarketRows,
  rankMarketMovers,
  tradeMarketAdjustment,
  type AfMarketRow,
} from '@/lib/trade-market/afTradeMarketReads'
import { marketWindows, runScheduledMarketRecalc } from '@/lib/trade-market/scheduledMarketRecalc'
import { buildTradeMarketOverlay, sleeperIdOfLine, tradeMarketAppliesTo } from '@/lib/trade-value-console/tradeMarketOverlay'
import { gradeOnLeagueValue } from '@/lib/trade-value-console/leagueGrade'
import type { PricedAsset } from '@/lib/hybrid-valuation'
import type { TradeConsolePlayerLine } from '@/lib/trade-value-console/types'

const NOW = new Date('2026-11-11T12:00:00Z')
const fresh = new Date('2026-11-10T10:00:00Z')
const stale = new Date(NOW.getTime() - (AF_MARKET_MAX_AGE_DAYS + 1) * 86_400_000)

const row = (over: Partial<AfMarketRow> = {}): AfMarketRow => ({
  playerId: '4034',
  playerName: 'Christian McCaffrey',
  position: 'RB',
  baseValue: 5000,
  marketValue: 5400,
  adjustmentPercent: 8,
  confidence: 80,
  sampleSize: 20,
  direction: 'rising',
  generatedAt: fresh,
  ...over,
})

const line = (over: Partial<TradeConsolePlayerLine> = {}): TradeConsolePlayerLine =>
  ({
    name: 'Christian McCaffrey',
    playerId: 'NFL:4034',
    enrichmentPlayerId: '4034',
    sport: 'NFL',
    position: 'RB',
    team: 'SF',
    headshotUrl: null,
    logoUrl: null,
    injuryStatus: null,
    dataSource: 'sleeper',
    composite: 0,
    marketValue: 5000,
    pricedSource: 'fantasycalc',
    ...over,
  }) as TradeConsolePlayerLine

const priced = (marketValue: number): PricedAsset =>
  ({ name: 'x', type: 'player', value: marketValue, source: 'fantasycalc', assetValue: { marketValue, impactValue: 0, vorpValue: 0, volatility: 0 } }) as unknown as PricedAsset

describe('which market rows may move a grade', () => {
  it('accepts a fresh, evidenced, non-QB move', () => {
    expect(isApplicableMarketRow(row(), NOW)).toBe(true)
  })
  it('refuses a stale run — a frozen market must not be applied to a moving chart', () => {
    expect(isApplicableMarketRow(row({ generatedAt: stale }), NOW)).toBe(false)
  })
  it('refuses QBs — the population mixes superflex and 1QB prices', () => {
    expect(isApplicableMarketRow(row({ position: 'QB' }), NOW)).toBe(false)
  })
  it('refuses thin samples and zero moves', () => {
    expect(isApplicableMarketRow(row({ sampleSize: 4 }), NOW)).toBe(false)
    expect(isApplicableMarketRow(row({ adjustmentPercent: 0 }), NOW)).toBe(false)
  })
})

describe('the visible adjustment', () => {
  it('is a factor with a reason naming the evidence', () => {
    const a = tradeMarketAdjustment(row({ adjustmentPercent: -6.34, sampleSize: 11 }))
    expect(a.kind).toBe('tradeMarket')
    expect(a.factor).toBeCloseTo(0.937, 3)
    expect(a.reason).toContain('-6.3%')
    expect(a.reason).toContain('11 completed trades')
  })
})

describe('reading rows', () => {
  it('asks only for fresh published completed-trade rows, by numeric Sleeper id, and drops QBs', async () => {
    const findMany = vi.fn(async () => [row(), row({ playerId: '6797', position: 'QB' })])
    const map = await loadAfTradeMarketRows({ allFantasyMarketPlayerValue: { findMany } }, ['4034', '6797', 'NFL:abc', ' '], NOW)
    const where = (findMany.mock.calls[0]![0] as { where: Record<string, unknown> }).where
    expect(where).toMatchObject({ sport: 'NFL', leagueConcept: 'dynasty', sourceVersion: 'completed-trade-signals', published: true })
    expect((where.playerId as { in: string[] }).in).toEqual(['4034', '6797'])
    expect([...map.keys()]).toEqual(['4034'])
  })
  it('a read failure is an empty map, so the grade runs on the chart alone', async () => {
    const findMany = vi.fn(async () => { throw new Error('db down') })
    await expect(loadAfTradeMarketRows({ allFantasyMarketPlayerValue: { findMany } }, ['4034'], NOW)).resolves.toEqual(new Map())
  })
})

describe('the overlay on a console grade', () => {
  it('applies only on the NFL dynasty 1QB chart', () => {
    expect(tradeMarketAppliesTo({ effectiveSport: 'NFL', chartIsDynasty: true, isSuperFlex: false })).toBe(true)
    expect(tradeMarketAppliesTo({ effectiveSport: 'NFL', chartIsDynasty: false, isSuperFlex: false })).toBe(false)
    expect(tradeMarketAppliesTo({ effectiveSport: 'NFL', chartIsDynasty: true, isSuperFlex: true })).toBe(false)
    expect(tradeMarketAppliesTo({ effectiveSport: 'NBA', chartIsDynasty: true, isSuperFlex: false })).toBe(false)
  })

  it('reads the Sleeper id from the enrichment id, the NFL: row id, or a bare id', () => {
    expect(sleeperIdOfLine({ enrichmentPlayerId: '4034', playerId: null })).toBe('4034')
    expect(sleeperIdOfLine({ enrichmentPlayerId: null, playerId: 'NFL:4034' })).toBe('4034')
    expect(sleeperIdOfLine({ enrichmentPlayerId: 'abc', playerId: '4034' })).toBe('4034')
    expect(sleeperIdOfLine({ enrichmentPlayerId: null, playerId: 'ESPN:99' })).toBeNull()
  })

  it('moves the matched player, leaves picks and unmatched players alone, and the grade follows', () => {
    const giveLines = [line()]
    const getLines = [
      line({ name: 'Other Guy', playerId: 'NFL:9999', enrichmentPlayerId: '9999', marketValue: 5000 }),
      line({ name: '2027 1st', playerId: null, enrichmentPlayerId: null, pricedSource: 'pick', marketValue: 0 }),
    ]
    const givePriced = [priced(5000)]
    const getPriced = [priced(5000), priced(0)]
    const overlay = buildTradeMarketOverlay({ giveLines, getLines, givePriced, getPriced, rows: new Map([['4034', row()]]) })!
    expect(overlay.summary.lines).toEqual([
      { side: 'give', name: 'Christian McCaffrey', adjustmentPercent: 8, trades: 20, chartValue: 5000, tradeMarketValue: 5400 },
    ])
    expect(overlay.tradeMarket.get).toEqual([null, null])

    const chart = { dynasty: true, superflex: false, teams: 12, ppr: 1 }
    const without = gradeOnLeagueValue({ giveLines, getLines, givePriced, getPriced, league: null, chart, needFactors: null })
    const withMarket = gradeOnLeagueValue({ giveLines, getLines, givePriced, getPriced, league: null, chart, needFactors: null, tradeMarket: overlay.tradeMarket })
    expect(without.totals.giveLeague).toBe(5000)
    expect(withMarket.totals.giveLeague).toBe(5400)
    expect(withMarket.totals.giveBase).toBe(5000)
    expect(withMarket.giveLines[0]!.valueAdjustments?.[0]?.kind).toBe('tradeMarket')
    expect(withMarket.valueBasis.tradeMarketAdjusted).toBe(true)
    expect(withMarket.valueBasis.label).toContain('AllFantasy trade market')
    expect(without.valueBasis.label).not.toContain('AllFantasy trade market')
  })

  it('is null when nothing matched, so the grade is untouched', () => {
    expect(buildTradeMarketOverlay({ giveLines: [line()], getLines: [line()], givePriced: [priced(1)], getPriced: [priced(1)], rows: new Map() })).toBeNull()
  })

  it('a market adjustment is never applied to a pick line even if one is passed', () => {
    const pick = line({ pricedSource: 'pick', marketValue: 3000 })
    const g = gradeOnLeagueValue({
      giveLines: [pick], getLines: [line()], givePriced: [priced(3000)], getPriced: [priced(3000)],
      league: null, chart: { dynasty: true, superflex: false, teams: 12, ppr: 1 }, needFactors: null,
      tradeMarket: { give: [tradeMarketAdjustment(row())], get: [null] },
    })
    expect(g.totals.giveLeague).toBe(3000)
  })
})

describe('the movers board', () => {
  it('ranks fresh confident movers each way and says so when nothing is fresh', () => {
    const board = rankMarketMovers([
      row({ playerId: '1', adjustmentPercent: 4, sampleSize: 9 }),
      row({ playerId: '2', adjustmentPercent: 11 }),
      row({ playerId: '3', adjustmentPercent: -7 }),
      row({ playerId: '4', adjustmentPercent: 12, position: 'QB' }),
      row({ playerId: '5', adjustmentPercent: 9, confidence: 30 }),
    ], 5, NOW)
    expect(board.fresh).toBe(true)
    expect(board.rising.map((m) => m.playerId)).toEqual(['2', '1'])
    expect(board.falling.map((m) => m.playerId)).toEqual(['3'])
    expect(rankMarketMovers([], 5, NOW)).toMatchObject({ fresh: false, rising: [], falling: [] })
  })
})

describe('the scheduled writer', () => {
  it('tries the current season first, then widens', () => {
    expect(marketWindows(NOW)).toEqual([2026, 2025, 2024])
    expect(marketWindows(new Date('2026-03-01T00:00:00Z'))).toEqual([2025, 2024, 2023])
  })

  it('stops at the first centred window that writes, and records refusals before it', async () => {
    const recalc = vi.fn(async (_p: unknown, o: { sinceSeason?: number }) =>
      o.sinceSeason === 2026
        ? { sport: 'NFL', evaluated: 10, published: 10, written: 0, tradesUsed: 300, medianAdjustment: 2.4, dryRun: false, refused: 'not_centred' as const }
        : { sport: 'NFL', evaluated: 300, published: 280, written: 280, tradesUsed: 4000, medianAdjustment: 0.3, dryRun: false, refused: null },
    )
    const r = await runScheduledMarketRecalc({} as never, { now: NOW, recalc: recalc as never })
    expect(recalc).toHaveBeenCalledTimes(2)
    for (const call of recalc.mock.calls) expect(call[1]).toMatchObject({ requireCentred: true, dryRun: false, sport: 'NFL' })
    expect(r).toMatchObject({ written: 280, sinceSeason: 2025 })
    expect(r.attempts.map((a) => a.refused)).toEqual(['not_centred', null])
  })

  it('writes nothing when every window is refused', async () => {
    const recalc = vi.fn(async () => ({ sport: 'NFL', evaluated: 1, published: 1, written: 0, tradesUsed: 1, medianAdjustment: 3, dryRun: false, refused: 'not_centred' as const }))
    const r = await runScheduledMarketRecalc({} as never, { now: NOW, recalc: recalc as never })
    expect(r.written).toBe(0)
    expect(r.attempts).toHaveLength(3)
  })
})

import { describe, expect, it, vi } from 'vitest'

import {
  AF_MARKET_MAX_AGE_DAYS,
  bookForChart,
  isApplicableMarketRow,
  lineupAdjustment,
  lineupNote,
  loadAfTradeMarketRows,
  loadLineupFactors,
  rankMarketMovers,
  tradeMarketAdjustment,
  type AfMarketRow,
} from '@/lib/trade-market/afTradeMarketReads'
import { bookConcept, type LineupFactorTable, type MarketBook } from '@/lib/trade-market/formatMarkets'
import { marketWindows, runScheduledMarketRecalc } from '@/lib/trade-market/scheduledMarketRecalc'
import { lineupProfileFromCounts } from '@/lib/league/lineupProfile'
import { buildTradeMarketOverlay, sleeperIdOfLine, tradeMarketAppliesTo } from '@/lib/trade-value-console/tradeMarketOverlay'
import { gradeOnLeagueValue } from '@/lib/trade-value-console/leagueGrade'
import type { PricedAsset } from '@/lib/hybrid-valuation'
import type { TradeConsolePlayerLine } from '@/lib/trade-value-console/types'

const NOW = new Date('2026-11-11T12:00:00Z')
const fresh = new Date('2026-11-10T10:00:00Z')
const stale = new Date(NOW.getTime() - (AF_MARKET_MAX_AGE_DAYS + 1) * 86_400_000)
const SF: MarketBook = { format: 'DYNASTY', qbFormat: 'SUPERFLEX' }
const ONE: MarketBook = { format: 'DYNASTY', qbFormat: 'ONE_QB' }

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

const factorTable = (over: Partial<LineupFactorTable> = {}): LineupFactorTable => ({
  generatedAt: fresh.toISOString(),
  sinceSeason: 2026,
  usual: { QB: { low: 2, high: 2 }, RB: { low: 2.45, high: 2.9 }, WR: { low: 2.45, high: 3.45 }, TE: { low: 1.1, high: 1.2 } },
  factors: [
    { position: 'TE', bucket: 'high', bound: 1.2, factor: 1.09, observations: 412, leagues: 31, trades: 260, standardObservations: 3000, published: true, note: 'measured across 260 trades in 31 leagues' },
    { position: 'QB', bucket: 'high', bound: 2, factor: 1.18, observations: 40, leagues: 3, trades: 18, standardObservations: 900, published: false, note: 'not enough evidence yet (40 of 100 player-trades, 3 of 8 leagues)' },
  ],
  ...over,
})

describe('which market rows may move a grade', () => {
  it('accepts a fresh, evidenced move — quarterbacks included, now that each format has its own market', () => {
    expect(isApplicableMarketRow(row(), NOW)).toBe(true)
    expect(isApplicableMarketRow(row({ position: 'QB' }), NOW)).toBe(true)
  })
  it('refuses a stale run — a frozen market must not be applied to a moving chart', () => {
    expect(isApplicableMarketRow(row({ generatedAt: stale }), NOW)).toBe(false)
  })
  it('refuses thin samples and zero moves', () => {
    expect(isApplicableMarketRow(row({ sampleSize: 4 }), NOW)).toBe(false)
    expect(isApplicableMarketRow(row({ adjustmentPercent: 0 }), NOW)).toBe(false)
  })
})

describe('the book a grade reads', () => {
  it('is the book its own chart is — a superflex grade never reads the 1QB market', () => {
    expect(bookForChart({ chartIsDynasty: true, isSuperFlex: true })).toEqual(SF)
    expect(bookForChart({ chartIsDynasty: false, isSuperFlex: false })).toEqual({ format: 'REDRAFT', qbFormat: 'ONE_QB' })
    expect(bookConcept(SF)).toBe('ct-dynasty-sf')
    expect(bookConcept(ONE)).toBe('ct-dynasty-1qb')
  })
})

describe('the visible adjustment', () => {
  it('is a factor with a reason naming the evidence and the format', () => {
    const a = tradeMarketAdjustment(row({ adjustmentPercent: -6.34, sampleSize: 11 }), SF)
    expect(a.kind).toBe('tradeMarket')
    expect(a.factor).toBeCloseTo(0.937, 3)
    expect(a.reason).toContain('-6.3%')
    expect(a.reason).toContain('11 completed Dynasty · Superflex trades')
  })
})

describe('reading rows', () => {
  it('asks only for fresh published rows of ONE book, by numeric Sleeper id', async () => {
    const findMany = vi.fn(async () => [row(), row({ playerId: '6797', position: 'QB' })])
    const map = await loadAfTradeMarketRows({ allFantasyMarketPlayerValue: { findMany } }, ['4034', '6797', 'NFL:abc', ' '], SF, NOW)
    const where = (findMany.mock.calls[0]![0] as { where: Record<string, unknown> }).where
    expect(where).toMatchObject({ sport: 'NFL', leagueConcept: 'ct-dynasty-sf', sourceVersion: 'completed-trade-signals', published: true })
    expect((where.playerId as { in: string[] }).in).toEqual(['4034', '6797'])
    expect([...map.keys()]).toEqual(['4034', '6797'])
  })
  it('a read failure is an empty map, so the grade runs on the chart alone', async () => {
    const findMany = vi.fn(async () => { throw new Error('db down') })
    await expect(loadAfTradeMarketRows({ allFantasyMarketPlayerValue: { findMany } }, ['4034'], SF, NOW)).resolves.toEqual(new Map())
  })
  it('an expired lineup table is not served', async () => {
    const findUnique = vi.fn(async () => ({ data: factorTable(), expiresAt: new Date(NOW.getTime() - 1) }))
    await expect(loadLineupFactors({ sportsDataCache: { findUnique } }, NOW)).resolves.toBeNull()
    findUnique.mockResolvedValueOnce({ data: factorTable(), expiresAt: new Date(NOW.getTime() + 1000) })
    await expect(loadLineupFactors({ sportsDataCache: { findUnique } }, NOW)).resolves.toMatchObject({ sinceSeason: 2026 })
  })
})

describe('lineup adjustments', () => {
  const twoTe = lineupProfileFromCounts({ qb: 1, sf: 1, rb: 2, wr: 3, te: 2, flex: 2 })!
  const fourQb = lineupProfileFromCounts({ qb: 4, rb: 2, wr: 3, te: 1, flex: 2 })!
  const usual = lineupProfileFromCounts({ qb: 1, sf: 1, rb: 2, wr: 3, te: 1, flex: 1 })!

  it('moves a TE in a 2-TE lineup by the measured, published factor, with the evidence in words', () => {
    const a = lineupAdjustment(factorTable(), twoTe, 'TE')!
    expect(a.kind).toBe('lineup')
    expect(a.factor).toBe(1.09)
    expect(a.reason).toContain('+9%')
    expect(a.reason).toContain('260 trades in 31 leagues')
  })
  it('does not move a position in the usual band, or one whose bucket is unpublished', () => {
    expect(lineupAdjustment(factorTable(), usual, 'TE')).toBeNull()
    expect(lineupAdjustment(factorTable(), fourQb, 'QB')).toBeNull()
  })
  it('says why an unusual lineup got no move — the 4-QB league today', () => {
    expect(lineupNote(factorTable(), fourQb, ['QB', 'RB'])).toMatch(/unusual for quarterbacks \(not enough evidence yet/)
    expect(lineupNote(factorTable(), usual, ['QB', 'TE'])).toBeNull()
    expect(lineupNote(null, usual, ['QB'])).toBe('Lineup adjustments are not measured yet.')
  })
})

describe('the overlay on a console grade', () => {
  it('applies on every NFL chart (each reads its own book), nowhere else', () => {
    expect(tradeMarketAppliesTo({ effectiveSport: 'NFL' })).toBe(true)
    expect(tradeMarketAppliesTo({ effectiveSport: 'NBA' })).toBe(false)
  })

  it('reads the Sleeper id from the enrichment id, the NFL: row id, or a bare id', () => {
    expect(sleeperIdOfLine({ enrichmentPlayerId: '4034', playerId: null })).toBe('4034')
    expect(sleeperIdOfLine({ enrichmentPlayerId: null, playerId: 'NFL:4034' })).toBe('4034')
    expect(sleeperIdOfLine({ enrichmentPlayerId: 'abc', playerId: '4034' })).toBe('4034')
    expect(sleeperIdOfLine({ enrichmentPlayerId: null, playerId: 'ESPN:99' })).toBeNull()
  })

  it('moves the matched player and the lineup-affected TE, leaves picks alone, and the grade follows', () => {
    const te = line({ name: 'Some TE', playerId: 'NFL:777', enrichmentPlayerId: '777', position: 'TE', marketValue: 2000 })
    const giveLines = [line()]
    const getLines = [te, line({ name: '2027 1st', playerId: null, enrichmentPlayerId: null, pricedSource: 'pick', position: 'PICK', marketValue: 0 })]
    const givePriced = [priced(5000)]
    const getPriced = [priced(2000), priced(0)]
    const lineup = lineupProfileFromCounts({ qb: 1, sf: 1, rb: 2, wr: 3, te: 2, flex: 2 })!
    const overlay = buildTradeMarketOverlay({ giveLines, getLines, givePriced, getPriced, rows: new Map([['4034', row()]]), book: SF, lineup, lineupFactors: factorTable() })!
    expect(overlay.summary.book).toBe('Dynasty · Superflex')
    expect(overlay.summary.lineup).toBe(lineup.label)
    expect(overlay.summary.lines.map((l) => [l.side, l.name, l.source, l.adjustmentPercent])).toEqual([
      ['give', 'Christian McCaffrey', 'market', 8],
      ['get', 'Some TE', 'lineup', 9],
    ])
    expect(overlay.tradeMarket.get).toEqual([null, null])
    expect(overlay.lineup.get[0]?.kind).toBe('lineup')
    expect(overlay.lineup.get[1]).toBeNull()

    const chart = { dynasty: true, superflex: true, teams: 12, ppr: 1 }
    const g = gradeOnLeagueValue({ giveLines, getLines, givePriced, getPriced, league: null, chart, needFactors: null, tradeMarket: overlay.tradeMarket, lineup: overlay.lineup })
    expect(g.totals.giveLeague).toBe(5400)
    expect(g.totals.getLeague).toBe(2180)
    expect(g.valueBasis.lineupAdjusted).toBe(true)
    expect(g.valueBasis.label).toContain('adjusted for this lineup')
  })

  it('is null when nothing matched and nothing needs saying, so the grade is untouched', () => {
    expect(buildTradeMarketOverlay({ giveLines: [line()], getLines: [line()], givePriced: [priced(1)], getPriced: [priced(1)], rows: new Map(), book: SF })).toBeNull()
  })

  it('carries the "unusual lineup, not measured" note even when no line moved', () => {
    const fourQb = lineupProfileFromCounts({ qb: 4, rb: 2, wr: 3, te: 1, flex: 2 })!
    const qb = line({ name: 'A QB', position: 'QB', enrichmentPlayerId: '1', playerId: 'NFL:1' })
    const overlay = buildTradeMarketOverlay({ giveLines: [qb], getLines: [line()], givePriced: [priced(1)], getPriced: [priced(1)], rows: new Map(), book: SF, lineup: fourQb, lineupFactors: factorTable() })!
    expect(overlay.summary.lines).toEqual([])
    expect(overlay.lineupNote).toMatch(/quarterbacks/)
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
    expect(board.rising.map((m) => m.playerId)).toEqual(['4', '2', '1'])
    expect(board.falling.map((m) => m.playerId)).toEqual(['3'])
    expect(rankMarketMovers([], 5, NOW)).toMatchObject({ fresh: false, rising: [], falling: [] })
  })
})

describe('the scheduled writer', () => {
  const lineup = (published: boolean): LineupFactorTable => factorTable({ factors: [{ ...factorTable().factors[0]!, published }] })
  const result = (books: Array<{ book: MarketBook; written: number; refused?: 'not_centred' }>, published: boolean) => ({
    books: books.map((b) => ({ book: b.book, concept: bookConcept(b.book), evaluated: 10, published: b.written, written: b.written, tradesUsed: 100, medianAdjustment: 0.2, refused: b.refused ?? null })),
    lineup: lineup(published),
    lineupWritten: false,
    tradesUsed: 100,
    skipped: {},
  })

  it('tries the current season first, then widens', () => {
    expect(marketWindows(NOW)).toEqual([2026, 2025, 2024])
    expect(marketWindows(new Date('2026-03-01T00:00:00Z'))).toEqual([2025, 2024, 2023])
  })

  it('widens only for the books a fresher window could not publish, and keeps the freshest published lineup table', async () => {
    const recalc = vi.fn(async (_p: unknown, o: { sinceSeason: number; skipBooks?: ReadonlySet<string> }) =>
      o.sinceSeason === 2026
        ? result([{ book: SF, written: 200 }, { book: ONE, written: 0, refused: 'not_centred' }], true)
        : result([{ book: ONE, written: 150 }], false),
    )
    const writeLineup = vi.fn(async () => {})
    const r = await runScheduledMarketRecalc({} as never, { now: NOW, recalc: recalc as never, writeLineup })
    for (const call of recalc.mock.calls) expect(call[1]).toMatchObject({ requireCentred: true, dryRun: false, writeLineupFactors: false })
    expect((recalc.mock.calls[1]![1] as { skipBooks: Set<string> }).skipBooks.has('DYNASTY:SUPERFLEX')).toBe(true)
    expect(r.books.map((b) => [b.concept, b.sinceSeason])).toEqual([['ct-dynasty-sf', 2026], ['ct-dynasty-1qb', 2025]])
    expect(writeLineup).toHaveBeenCalledTimes(1)
    expect(writeLineup.mock.calls[0]![1]).toMatchObject({ sinceSeason: 2026 })
    expect(r.lineup).toMatchObject({ published: 1, sinceSeason: 2026 })
  })

  it('writes no market when every window is refused, and still records the lineup table it measured', async () => {
    const recalc = vi.fn(async () => result([{ book: SF, written: 0, refused: 'not_centred' }], false))
    const writeLineup = vi.fn(async () => {})
    const r = await runScheduledMarketRecalc({} as never, { now: NOW, recalc: recalc as never, writeLineup })
    expect(r.written).toBe(0)
    expect(r.attempts).toHaveLength(3)
    expect(writeLineup).toHaveBeenCalledTimes(1)
  })
})

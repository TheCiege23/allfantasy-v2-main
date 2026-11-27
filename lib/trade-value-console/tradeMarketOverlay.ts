import type { PricedAsset } from '@/lib/hybrid-valuation'
import type { LineupProfile } from '@/lib/league/lineupProfile'
import type { LeagueValueAdjustment } from '@/lib/trade-value/leagueTradeValue'
import type { LineupFactorTable, MarketBook } from '@/lib/trade-market/formatMarkets'
import {
  bookForChart,
  bookLabel,
  lineupAdjustment,
  lineupNote,
  loadAfTradeMarketRows,
  loadLineupFactors,
  tradeMarketAdjustment,
  type AfMarketRow,
} from '@/lib/trade-market/afTradeMarketReads'
import type { TradeConsolePlayerLine, TradeConsoleTradeMarket } from './types'
import { applyLeagueAdjustments } from '@/lib/trade-value/leagueTradeValue'
import { bookKey } from '@/lib/trade-market/formatMarkets'
import { learnedPickAdjustment, learnedPicksOn, loadLearnedTables, type LearnedTables } from '@/lib/trade-market/learnedInGrades'

/**
 * The AllFantasy trade market and this league's lineup, applied to one console grade.
 *
 * WHICH MARKET: the book the grade's own chart is (`bookForChart`) — dynasty/redraft × 1QB/superflex —
 * so a superflex grade reads values measured from superflex trades, never 1QB ones. Applied only to
 * players the chart priced (`pricedSource === 'fantasycalc'`); a defender priced by the league's own
 * scoring, a pick and FAAB are left exactly as priced.
 *
 * WHICH LINEUP: the league's own starting lineup, or the format the open analyzer was told. A position
 * moves only where `computeLineupFactors` measured — with breadth — that leagues starting more (or
 * fewer) of it pay differently. An unusual lineup with too little evidence gets no move and a sentence.
 */
export function tradeMarketAppliesTo(args: { effectiveSport: string }): boolean {
  return args.effectiveSport === 'NFL'
}

/** The Sleeper id a console line was priced under, or null. */
export function sleeperIdOfLine(l: Pick<TradeConsolePlayerLine, 'enrichmentPlayerId' | 'playerId'>): string | null {
  const enrich = l.enrichmentPlayerId?.trim()
  if (enrich && /^\d+$/.test(enrich)) return enrich
  const id = l.playerId?.trim()
  if (!id) return null
  if (/^NFL:\d+$/i.test(id)) return id.slice(4)
  return /^\d+$/.test(id) ? id : null
}

type Adjustments = { give: Array<LeagueValueAdjustment | null>; get: Array<LeagueValueAdjustment | null> }

/**
 * Pure: the two moves ONE chart-priced player takes — the trade market for his Sleeper id in this book, and
 * the lineup for his position. `buildTradeMarketOverlay` uses it for every player line, and the grader uses
 * it for every player on a startup/redraft draft board (`draftBoardPickPricing.ts`), so a board pick moves
 * through exactly the moves its expected players would take as lines in a deal.
 */
export function boardPlayerMarketAdjustments(args: {
  sleeperId: string | null
  position: string | null | undefined
  rows: ReadonlyMap<string, AfMarketRow>
  book: MarketBook
  lineup?: LineupProfile | null
  lineupFactors?: LineupFactorTable | null
}): { market: LeagueValueAdjustment | null; lineup: LeagueValueAdjustment | null } {
  const row = args.sleeperId ? args.rows.get(args.sleeperId) : undefined
  return {
    market: row ? tradeMarketAdjustment(row, args.book) : null,
    lineup: lineupAdjustment(args.lineupFactors ?? null, args.lineup ?? null, args.position),
  }
}

/**
 * Pure: board players' values moved as their player lines would be. Only a CHART-priced player moves — one
 * priced on the AF market book (`source: 'allfantasy'`) is already at what managers paid, exactly as
 * `buildTradeMarketOverlay` leaves an `allfantasy` line alone. Same product and clamp as a line
 * (`applyLeagueAdjustments`). `moved[i]` says whether player i moved.
 */
export function moveBoardPlayerValues<T extends { value: number | null; sleeperId: string | null; position: string | null; chartPriced: boolean }>(
  base: readonly T[],
  inputs: { rows: ReadonlyMap<string, AfMarketRow>; book: MarketBook; lineup?: LineupProfile | null; lineupFactors?: LineupFactorTable | null },
): { values: T[]; moved: boolean[] } {
  const moved: boolean[] = []
  const values = base.map((b) => {
    if (b.value == null || !b.chartPriced) return moved.push(false), b
    const moves = boardPlayerMarketAdjustments({ ...inputs, sleeperId: b.sleeperId, position: b.position })
    const valued = applyLeagueAdjustments(b.value, [moves.market, moves.lineup])
    if (valued.adjustments.length === 0 || valued.leagueValue == null) return moved.push(false), b
    moved.push(true)
    return { ...b, value: valued.leagueValue }
  })
  return { values, moved }
}

/**
 * Load what `boardPlayerMarketAdjustments` reads, for a set of board players. Null when the market does not
 * apply to this sport. Read failures leave the board on the bare chart, as they leave a player line.
 */
export async function loadBoardMarketInputs(
  prisma: Parameters<typeof loadAfTradeMarketRows>[0] & Parameters<typeof loadLineupFactors>[0],
  args: { effectiveSport: string; chartIsDynasty: boolean; isSuperFlex: boolean; lineup?: LineupProfile | null; sleeperIds: readonly string[] },
): Promise<{ rows: Map<string, AfMarketRow>; book: MarketBook; lineup: LineupProfile | null; lineupFactors: LineupFactorTable | null } | null> {
  if (!tradeMarketAppliesTo(args)) return null
  const book = bookForChart(args)
  const ids = [...new Set(args.sleeperIds.filter(Boolean))]
  const [rows, lineupFactors] = await Promise.all([
    ids.length ? loadAfTradeMarketRows(prisma, ids, book).catch(() => new Map<string, AfMarketRow>()) : Promise.resolve(new Map<string, AfMarketRow>()),
    args.lineup ? loadLineupFactors(prisma).catch(() => null) : Promise.resolve(null),
  ])
  return { rows, book, lineup: args.lineup ?? null, lineupFactors }
}

/** Pure: rows + lineup factors → index-aligned adjustments and the summary shown beside the grade. */
export function buildTradeMarketOverlay(args: {
  giveLines: readonly TradeConsolePlayerLine[]
  getLines: readonly TradeConsolePlayerLine[]
  givePriced: readonly PricedAsset[]
  getPriced: readonly PricedAsset[]
  rows: ReadonlyMap<string, AfMarketRow>
  book: MarketBook
  lineup?: LineupProfile | null
  lineupFactors?: LineupFactorTable | null
  /** The learned tables, when `TRADE_LEARNED_PICKS=on` (`learnedInGrades.ts`); absent leaves picks as priced. */
  learned?: LearnedTables | null
  teams?: number | null
  now?: Date
}): { tradeMarket: Adjustments; lineup: Adjustments; learnedPicks: Adjustments; lineupNote: string | null; summary: TradeConsoleTradeMarket } | null {
  const lines: TradeConsoleTradeMarket['lines'] = []
  let latest: Date | null = null
  const market: Adjustments = { give: [], get: [] }
  const lineup: Adjustments = { give: [], get: [] }
  const learnedPicks: Adjustments = { give: [], get: [] }
  let picksMoved = 0

  for (const side of ['give', 'get'] as const) {
    const ls = side === 'give' ? args.giveLines : args.getLines
    const ps = side === 'give' ? args.givePriced : args.getPriced
    ls.forEach((l, i) => {
      const priced = !l.unpriced && l.pricedSource === 'fantasycalc'
      const chartValue = ps[i]?.assetValue.marketValue ?? null
      let m: LeagueValueAdjustment | null = null
      let u: LeagueValueAdjustment | null = null
      if (priced) {
        const id = sleeperIdOfLine(l)
        const row = id ? args.rows.get(id) : undefined
        const moves = boardPlayerMarketAdjustments({ sleeperId: id, position: l.position, rows: args.rows, book: args.book, lineup: args.lineup, lineupFactors: args.lineupFactors })
        if (row && moves.market) {
          m = moves.market
          lines.push({
            side,
            name: l.name,
            source: 'market',
            adjustmentPercent: Math.round(row.adjustmentPercent * 10) / 10,
            trades: row.sampleSize,
            chartValue,
            tradeMarketValue: chartValue == null ? null : Math.round(chartValue * m.factor),
            reason: m.reason,
          })
          if (!latest || row.generatedAt > latest) latest = row.generatedAt
        }
        u = moves.lineup
        if (u) {
          const f = args.lineupFactors!.factors.find((x) => x.position === String(l.position).toUpperCase() && Math.abs(x.factor - u!.factor) < 1e-9)
          lines.push({
            side,
            name: l.name,
            source: 'lineup',
            adjustmentPercent: Math.round((u.factor - 1) * 1000) / 10,
            trades: f?.trades ?? 0,
            chartValue,
            tradeMarketValue: chartValue == null ? null : Math.round(chartValue * u.factor),
            reason: u.reason,
          })
        }
      }
      market[side].push(m)
      lineup[side].push(u)
      /*
       * 🛑 A board-priced pick (a startup/redraft draft) is never moved by the learned PICK market. That market
       * measures rookie slots ("2026 Pick 1.04"); a board pick is the mean of the players expected there, and
       * those players already carry their own trade-market moves (`moveBoardPlayerValues`, applied before the
       * mean). Moving it again by a rookie-slot market would count a second, unrelated market against it.
       */
      const pickMove = args.learned && l.pricedSource === 'pick' && l.dataSource !== 'draft_board'
        ? learnedPickAdjustment(args.learned, bookKey(args.book), l.name, args.teams ?? null, args.now ?? new Date())
        : null
      if (pickMove) picksMoved++
      learnedPicks[side].push(pickMove)
    })
  }

  const positions = [...args.giveLines, ...args.getLines].filter((l) => l.pricedSource === 'fantasycalc').map((l) => l.position)
  const note = lineupNote(args.lineupFactors ?? null, args.lineup ?? null, positions)
  if (lines.length === 0 && !note && picksMoved === 0) return null
  const generated = latest as Date | null
  return {
    tradeMarket: market,
    lineup,
    learnedPicks,
    lineupNote: note,
    summary: {
      generatedAt: generated ? generated.toISOString() : args.lineupFactors?.generatedAt ?? null,
      book: bookLabel(args.book),
      lineup: args.lineup?.label ?? null,
      note,
      lines,
    },
  }
}

/** Load and build. Null whenever nothing applies — the grade is then exactly what the chart says. */
export async function loadTradeMarketOverlay(
  prisma: Parameters<typeof loadAfTradeMarketRows>[0] & Parameters<typeof loadLineupFactors>[0],
  args: {
    effectiveSport: string
    chartIsDynasty: boolean
    isSuperFlex: boolean
    lineup?: LineupProfile | null
    giveLines: readonly TradeConsolePlayerLine[]
    getLines: readonly TradeConsolePlayerLine[]
    givePriced: readonly PricedAsset[]
    getPriced: readonly PricedAsset[]
    teams?: number | null
  },
): Promise<ReturnType<typeof buildTradeMarketOverlay>> {
  if (!tradeMarketAppliesTo(args)) return null
  const book = bookForChart(args)
  const ids = [...args.giveLines, ...args.getLines].map(sleeperIdOfLine).filter((x): x is string => Boolean(x))
  const hasPick = [...args.giveLines, ...args.getLines].some((l) => l.pricedSource === 'pick')
  const [rows, lineupFactors, learned] = await Promise.all([
    ids.length ? loadAfTradeMarketRows(prisma, ids, book) : Promise.resolve(new Map<string, AfMarketRow>()),
    args.lineup ? loadLineupFactors(prisma) : Promise.resolve(null),
    hasPick && learnedPicksOn() ? loadLearnedTables(prisma).catch(() => null) : Promise.resolve(null),
  ])
  return buildTradeMarketOverlay({ ...args, rows, book, lineupFactors, learned })
}

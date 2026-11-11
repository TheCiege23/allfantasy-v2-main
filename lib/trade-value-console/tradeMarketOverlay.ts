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
}): { tradeMarket: Adjustments; lineup: Adjustments; lineupNote: string | null; summary: TradeConsoleTradeMarket } | null {
  const lines: TradeConsoleTradeMarket['lines'] = []
  let latest: Date | null = null
  const market: Adjustments = { give: [], get: [] }
  const lineup: Adjustments = { give: [], get: [] }

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
        if (row) {
          m = tradeMarketAdjustment(row, args.book)
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
        u = lineupAdjustment(args.lineupFactors ?? null, args.lineup ?? null, l.position)
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
    })
  }

  const positions = [...args.giveLines, ...args.getLines].filter((l) => l.pricedSource === 'fantasycalc').map((l) => l.position)
  const note = lineupNote(args.lineupFactors ?? null, args.lineup ?? null, positions)
  if (lines.length === 0 && !note) return null
  const generated = latest as Date | null
  return {
    tradeMarket: market,
    lineup,
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
  },
): Promise<ReturnType<typeof buildTradeMarketOverlay>> {
  if (!tradeMarketAppliesTo(args)) return null
  const book = bookForChart(args)
  const ids = [...args.giveLines, ...args.getLines].map(sleeperIdOfLine).filter((x): x is string => Boolean(x))
  const [rows, lineupFactors] = await Promise.all([
    ids.length ? loadAfTradeMarketRows(prisma, ids, book) : Promise.resolve(new Map<string, AfMarketRow>()),
    args.lineup ? loadLineupFactors(prisma) : Promise.resolve(null),
  ])
  return buildTradeMarketOverlay({ ...args, rows, book, lineupFactors })
}

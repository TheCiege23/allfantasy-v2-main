import type { PricedAsset } from '@/lib/hybrid-valuation'
import type { LeagueValueAdjustment } from '@/lib/trade-value/leagueTradeValue'
import {
  loadAfTradeMarketRows,
  tradeMarketAdjustment,
  type AfMarketRow,
} from '@/lib/trade-market/afTradeMarketReads'
import type { TradeConsolePlayerLine, TradeConsoleTradeMarket } from './types'

/**
 * The AllFantasy trade market, applied to one console grade.
 *
 * WHERE IT APPLIES: an NFL deal on the DYNASTY · 1QB chart, for players the chart priced
 * (`pricedSource === 'fantasycalc'`). That is the board the market was measured against
 * (`completedTradeObservations.ts`), so the percentage means the same thing here as it did there.
 * A redraft or superflex chart, a defender priced by the league's own scoring, a pick and FAAB are all
 * left exactly as the chart priced them.
 */
export function tradeMarketAppliesTo(args: { effectiveSport: string; chartIsDynasty: boolean; isSuperFlex: boolean }): boolean {
  return args.effectiveSport === 'NFL' && args.chartIsDynasty && !args.isSuperFlex
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

/** Pure: rows → index-aligned adjustments and the summary shown beside the grade. */
export function buildTradeMarketOverlay(args: {
  giveLines: readonly TradeConsolePlayerLine[]
  getLines: readonly TradeConsolePlayerLine[]
  givePriced: readonly PricedAsset[]
  getPriced: readonly PricedAsset[]
  rows: ReadonlyMap<string, AfMarketRow>
}): { tradeMarket: { give: Array<LeagueValueAdjustment | null>; get: Array<LeagueValueAdjustment | null> }; summary: TradeConsoleTradeMarket } | null {
  const summary: TradeConsoleTradeMarket = { generatedAt: null, lines: [] }
  let latest: Date | null = null
  const side = (which: 'give' | 'get', lines: readonly TradeConsolePlayerLine[], priced: readonly PricedAsset[]) =>
    lines.map((l, i): LeagueValueAdjustment | null => {
      if (l.unpriced || l.pricedSource !== 'fantasycalc') return null
      const id = sleeperIdOfLine(l)
      const row = id ? args.rows.get(id) : undefined
      if (!row) return null
      const adj = tradeMarketAdjustment(row)
      const chartValue = priced[i]?.assetValue.marketValue ?? null
      summary.lines.push({
        side: which,
        name: l.name,
        adjustmentPercent: Math.round(row.adjustmentPercent * 10) / 10,
        trades: row.sampleSize,
        chartValue,
        tradeMarketValue: chartValue == null ? null : Math.round(chartValue * adj.factor),
      })
      if (!latest || row.generatedAt > latest) latest = row.generatedAt
      return adj
    })
  const give = side('give', args.giveLines, args.givePriced)
  const get = side('get', args.getLines, args.getPriced)
  if (summary.lines.length === 0) return null
  summary.generatedAt = latest ? (latest as Date).toISOString() : null
  return { tradeMarket: { give, get }, summary }
}

/** Load and build. Null whenever the market does not apply or has nothing fresh for these players. */
export async function loadTradeMarketOverlay(
  prisma: Parameters<typeof loadAfTradeMarketRows>[0],
  args: {
    effectiveSport: string
    chartIsDynasty: boolean
    isSuperFlex: boolean
    giveLines: readonly TradeConsolePlayerLine[]
    getLines: readonly TradeConsolePlayerLine[]
    givePriced: readonly PricedAsset[]
    getPriced: readonly PricedAsset[]
  },
): Promise<ReturnType<typeof buildTradeMarketOverlay>> {
  if (!tradeMarketAppliesTo(args)) return null
  const ids = [...args.giveLines, ...args.getLines].map(sleeperIdOfLine).filter((x): x is string => Boolean(x))
  if (ids.length === 0) return null
  const rows = await loadAfTradeMarketRows(prisma, ids)
  if (rows.size === 0) return null
  return buildTradeMarketOverlay({ ...args, rows })
}

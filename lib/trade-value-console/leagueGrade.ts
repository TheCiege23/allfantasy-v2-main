import type { PricedAsset } from '@/lib/hybrid-valuation'
import { scoringFit } from '@/lib/trade-value/scoringFit'
import {
  applyLeagueAdjustments,
  describeValueBasis,
  leagueTradeTotals,
  type LeagueTradeTotals,
  type LeagueValueAdjustment,
  type LeagueValuedLine,
} from '@/lib/trade-value/leagueTradeValue'
import type { NeedFactors } from '@/lib/trade-value/viewerNeedFactors'
import type { TradeConsoleAnalyzeResult, TradeConsolePlayerLine } from './types'

/** A pick or FAAB line: priced on its own curve, never by position rules or roster need. */
export function isNonPlayerLine(l: Pick<TradeConsolePlayerLine, 'pricedSource'>): boolean {
  return l.pricedSource === 'pick' || l.pricedSource === 'faab'
}

/** The market value a line is graded from, or null when the pricer found nothing. */
export function gradeBaseOf(l: TradeConsolePlayerLine, pa: PricedAsset | undefined): number | null {
  return l.unpriced || !pa ? null : pa.assetValue.marketValue
}

export type LeagueGradeInput = {
  giveLines: TradeConsolePlayerLine[]
  getLines: TradeConsolePlayerLine[]
  /** Priced assets, index-aligned with the lines (the console pushes them in pairs). */
  givePriced: PricedAsset[]
  getPriced: PricedAsset[]
  /** The league, when there is one. Null = global mode: graded on the chart alone, and labelled so. */
  league: {
    /** The league's `scoring_settings`, numeric (see `marketContextFor`). */
    scoringSettings: Record<string, number> | null
  } | null
  /** What the chart was fetched as. `ppr` MUST be the weight the chart was requested with. */
  chart: { dynasty: boolean; superflex: boolean; teams: number | null; ppr: number }
  needFactors: NeedFactors | null
}

export type LeagueGrade = {
  giveLines: TradeConsolePlayerLine[]
  getLines: TradeConsolePlayerLine[]
  totals: LeagueTradeTotals
  valueBasis: TradeConsoleAnalyzeResult['valueBasis']
}

/**
 * Price both sides of a deal for this league and total them — the numbers the verdict is graded on.
 * PURE. See `lib/trade-value/leagueTradeValue.ts` for the decision this implements.
 */
export function gradeOnLeagueValue(input: LeagueGradeInput): LeagueGrade {
  const { league, chart } = input
  const scoringAdjustment = (l: TradeConsolePlayerLine): LeagueValueAdjustment | null => {
    if (!league || isNonPlayerLine(l)) return null
    const fit = scoringFit(league.scoringSettings, l.position, chart.ppr)
    return fit && fit.multiplier !== 1 ? { kind: 'scoring', factor: fit.multiplier, reason: fit.reason } : null
  }
  const value = (lines: TradeConsolePlayerLine[], priced: PricedAsset[], need: NeedFactors['give'] | undefined) =>
    lines.map((l, i) => applyLeagueAdjustments(gradeBaseOf(l, priced[i]), [scoringAdjustment(l), need?.[i] ?? null]))
  const giveValued: LeagueValuedLine[] = value(input.giveLines, input.givePriced, input.needFactors?.give)
  const getValued: LeagueValuedLine[] = value(input.getLines, input.getPriced, input.needFactors?.get)
  const withLeagueValue = (lines: TradeConsolePlayerLine[], valued: LeagueValuedLine[]) =>
    lines.map((l, i) => ({ ...l, leagueValue: valued[i]?.leagueValue ?? null, valueAdjustments: valued[i]?.adjustments ?? [] }))

  const kinds = new Set([...giveValued, ...getValued].flatMap((v) => v.adjustments.map((a) => a.kind)))
  const bonusTe = league?.scoringSettings?.bonus_rec_te
  const chartWords = describeValueBasis({
    ...chart,
    tePremium: league && typeof bonusTe === 'number' ? bonusTe : null,
  })

  return {
    giveLines: withLeagueValue(input.giveLines, giveValued),
    getLines: withLeagueValue(input.getLines, getValued),
    totals: leagueTradeTotals(giveValued, getValued),
    valueBasis: {
      graded: league ? 'league' : 'market',
      label: league ? chartWords : `${chartWords} — no league selected, so no league rules apply`,
      scoringAdjusted: kinds.has('scoring'),
      needAdjusted: kinds.has('need'),
      needGap: input.needFactors?.gap ?? null,
    },
  }
}

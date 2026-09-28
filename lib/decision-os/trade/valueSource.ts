/**
 * WHICH evidence priced a traded asset — recorded on every grade line (2026-09-28). PURE, client-safe.
 *
 * A grade line's old `source` holds the PLAYER RECORD's origin (`sleeper`, `fantasycalc+rolling`), not
 * the value's, and no value carried a date — so a saved grade could not say which feed priced it or
 * as of when, which the Trade OS promotion gate requires (trade price coverage audit). The pricer
 * already knew (`PricedAsset.source`); it was dropped where grade lines were built.
 *
 *   fantasycalc        market value from FantasyCalc's chart            dated by the chart's sync
 *   fantasycalc_pick   a pick row on that chart (rounds 5+ decayed)     dated by the chart's sync
 *   league_idp         this league's scoring over the defender's games  scoped to a projection week
 *   league_kicker      this league's flat kicker formula                computed at grading
 *   league_defense     this league's flat team-defense formula          computed at grading
 *   faab_formula       FAAB scaled to this league's budget              computed at grading
 *   devy_option        a held college prospect's option value           static rate tables
 *   ncaaf_projection   college points over replacement                  computed at grading
 *   historical_file    the name-keyed historical value file             its snapshot date
 *   draft_analytics    a draft-capital lifetime value                   no date recorded
 *   position_baseline  a flat per-position constant                     no date recorded
 *   pick_curve         the formula pick curve                           no date recorded
 *   sports_db          a non-NFL player row's dynasty value/projection  no date recorded
 */
export type TradeValueSource =
  | 'fantasycalc'
  | 'fantasycalc_pick'
  | 'league_idp'
  | 'league_kicker'
  | 'league_defense'
  | 'faab_formula'
  | 'devy_option'
  | 'ncaaf_projection'
  | 'historical_file'
  | 'draft_analytics'
  | 'position_baseline'
  | 'pick_curve'
  | 'sports_db'

/** What the pricer and the line say about one asset — the fields this reads, nothing more. */
type PricedLike = { source?: string | null; unpriced?: boolean | null }
type LineLike = { dataSource?: string | null; position?: string | null; unpriced?: boolean | null }

/** The evidence behind one priced asset, or null when it was not priced. */
export function tradeValueSourceOf(priced: PricedLike | null | undefined, line: LineLike): TradeValueSource | null {
  if (line.unpriced || priced?.unpriced) return null
  // Line-level sources first: FAAB, devy and college values are priced outside `pricePlayer`.
  if (line.dataSource === 'league_waiver_budget') return 'faab_formula'
  if (line.dataSource === 'devy-option' || priced?.source === 'devy-option') return 'devy_option'
  if (line.dataSource === 'ncaaf-redraft-vorp') return 'ncaaf_projection'
  switch (priced?.source) {
    case 'fantasycalc':
      return String(line.position ?? '').toUpperCase() === 'PICK' ? 'fantasycalc_pick' : 'fantasycalc'
    case 'idp-vorp': return 'league_idp'
    case 'kicker-flat': return 'league_kicker'
    case 'dst-flat': return 'league_defense'
    case 'excel': return 'historical_file'
    case 'analytics-lifetime': return 'draft_analytics'
    case 'idp-flat-baseline': return 'position_baseline'
    case 'curve': return 'pick_curve'
    // A priced asset with no named source is a non-NFL row priced off its dynasty value/projection.
    case 'unknown': return 'sports_db'
    default: return null
  }
}

/** When the evidence was captured: only a market chart has a sync time; league math is taken at grading. */
export function tradeValueAsOf(source: TradeValueSource | null, chartSyncedAt: string | null | undefined): string | null {
  return source === 'fantasycalc' || source === 'fantasycalc_pick' ? chartSyncedAt ?? null : null
}

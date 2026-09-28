import { resolveLeagueRules } from './resolveLeagueRules'

/**
 * Does this league's FORMAT allow trades? The one answer, for every surface that asks.
 *
 * 🛑 IT COMES FROM THE CONCEPT CATALOG, NOT FROM "IS IT A GUILLOTINE". Two surfaces got this wrong the
 * same way. The Player Finder and Chimmy's first format gate both refused trades in every guillotine
 * and survivor league. The catalog (`./conceptCatalog.ts`), the per-format rules authority, marks
 * trading LEGAL in both: `lib/trade-intel/guillotine.ts` prices guillotine trades by weeks left, and
 * survivor's entry recommends tribemate deals. Only Survivor All-Stars Guillotine ("no trades at all")
 * and Tournament ("entries are not rosters that trade") forbid them.
 *
 * ⚠ NOT `readFormatRules`. It maps a confirmed `survivor_guillotine` onto its `guillotine` chassis, so
 * it cannot tell the one no-trade guillotine from the ones that trade. `resolveLeagueRules` keeps the
 * confirmed concept.
 *
 * ⚠ BEST BALL IS DELIBERATELY NOT HONOURED. Its catalog entry says only "typically draft-and-hold",
 * and best-ball import permissions are recorded as unverified, so refusing a trade there would claim
 * what no evidence supports.
 *
 * Production, read-only (2026-09-28): 18 tournament and 1 survivor-guillotine league forbid trades;
 * 14 guillotine and 2 survivor leagues allow them.
 *
 * Pure: reads fields the caller already holds.
 */
export type TradeLegalityInput = {
  leagueType: string | null | undefined
  isDynasty: boolean | null | undefined
  settings: unknown
}

/** The catalog's reason a league's format forbids trades, or null when trades are allowed or unknown. */
export function tradeBanReason(league: TradeLegalityInput): string | null {
  const concept = resolveLeagueRules({ leagueType: league.leagueType, isDynasty: league.isDynasty, settings: league.settings }).concept
  if (!concept || concept.id === 'best_ball') return null
  const trade = concept.actions.find((a) => a.id === 'trade')
  return trade && trade.legalInFormat === false ? (trade.note ?? `${concept.label} leagues do not allow trades.`) : null
}

/** True when the league's format has no trade market, per the concept catalog. */
export function leagueForbidsTrades(league: TradeLegalityInput): boolean {
  return tradeBanReason(league) !== null
}

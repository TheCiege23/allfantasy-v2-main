/**
 * This week's LINEUP projections for a Your Week matchup — AllFantasy's own engine (AF) and the
 * provider's (API), each summed over the lineup as set and scored under the league's rules.
 *
 * ⚠ NOT A SECOND LOAD. These are the totals the league rail already computed for the shell
 * (`getRailMatchups`) on the same page render; the Your Week screens are handed that object, so this
 * costs no query. It is also a DIFFERENT MEASURE from the week board's `projection`, which is each
 * team's fitted average over its completed weeks — surfaces label the two apart.
 *
 * ⚠ SAME WEEK ONLY. The rail's projection feed can fall back to another week when this one is not
 * published (`RailMatchups.projectionWeek`); a total for the wrong week beside this week's matchup
 * would read as this week's, so nothing is returned for it.
 *
 * Client-safe: type imports only.
 */

import type { RailMatchup, RailSideProjection } from './railMatchups'

export type WeekLineups = {
  byLeague: Record<string, RailMatchup>
  projectionWeek: { season: string; week: number } | null
}

export type LineupProjectionView = {
  /** AF totals, you and them. `them` is null in an elimination week or when unpriced. */
  af: { you: number | null; them: number | null } | null
  /** The provider's totals under the league's rules. */
  api: { you: number | null; them: number | null } | null
  /** Some side's total was built from only part of its lineup. */
  partial: boolean
  /** No opponent side — an elimination week. */
  unpaired: boolean
}

const afOf = (p: RailSideProjection | null | undefined) => (p?.afEngine != null ? p.afEngine : null)
const apiOf = (p: RailSideProjection | null | undefined) => (p?.afProjected != null ? p.afProjected : null)
const partialOf = (p: RailSideProjection | null | undefined) =>
  p != null && ((p.afEngine != null && (p.afEngineFrom ?? 0) < p.starterCount) || (p.afProjected != null && p.pricedFrom < p.starterCount))

export function lineupProjectionFor(
  lineups: WeekLineups | null | undefined,
  leagueId: string,
  season: number,
  week: number,
): LineupProjectionView | null {
  const m = lineups?.byLeague[leagueId]
  const pw = lineups?.projectionWeek
  if (!m || !pw || m.season !== season || m.week !== week) return null
  if (Number(pw.season) !== season || pw.week !== week) return null
  const unpaired = m.unpaired
  const af = { you: afOf(m.yourProjection), them: unpaired ? null : afOf(m.opponentProjection) }
  const api = { you: apiOf(m.yourProjection), them: unpaired ? null : apiOf(m.opponentProjection) }
  const hasAf = af.you != null || af.them != null
  const hasApi = api.you != null || api.them != null
  if (!hasAf && !hasApi) return null
  return {
    af: hasAf ? af : null,
    api: hasApi ? api : null,
    partial: partialOf(m.yourProjection) || (!unpaired && partialOf(m.opponentProjection)),
    unpaired,
  }
}

/** "121.5–115.0", "121.5" alone for an elimination week, "—" for a side that did not price. */
export function lineupPairText(pair: { you: number | null; them: number | null }, unpaired: boolean): string {
  const f = (v: number | null) => (v == null ? '—' : v.toFixed(1))
  return unpaired ? f(pair.you) : `${f(pair.you)}–${f(pair.them)}`
}

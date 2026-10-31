/**
 * Rookie fields for NBA / NHL / MLB (every non-NFL) draft-pool row, from data already in Postgres.
 *
 * Mirrors the NFL path's FIRST source: `getResolvedDraftPoolForLeague` takes an explicit
 * `yearsExp` on the row before anything else and records it as `explicit_imported`; the
 * normalizer then sets `isRookie` when it is 0. Outside NFL nothing ever reached that rule,
 * because the pool resolver selected no experience column and the non-NFL enrichment attached
 * none. `SportsPlayer.yearsExp` is sport-agnostic in the schema ("0 is a rookie; NULL is we do
 * not know") — this carries it through for every sport, under the same rule.
 *
 * ⚠ CARRYING THE COLUMN IS NOT THE SAME AS HAVING THE DATA. As of 2026-10-20 the only writers of
 * `SportsPlayer.yearsExp` are NFL-scoped (`refreshSleeperPlayerRows` is called with `NFL` only,
 * `scripts/sync-rookies-from-sleeper.ts`, `scripts/backfill-player-years-exp.ts`), and
 * `SleeperPlayerSeedService`, which can write NBA, has no caller. So an NBA row is labelled only
 * where a row already carries experience; filling it is an ingestion decision recorded in
 * `contracts/sleeper/GAPS.md` S-09. No provider is called here.
 *
 * Unknown stays unknown: nothing here turns a NULL into 0, and a known experience overrules the
 * `gamesPlayed === 0` stats heuristic (`extractRookieHint`), which fires for injured veterans.
 */
import type { NflRookieYearsExpProvenance } from '@/lib/draft-sports-models/types'

function finiteNonNegative(value: unknown): number | null {
  if (value == null || value === '') return null
  const n = Number(value)
  return Number.isFinite(n) && n >= 0 ? n : null
}

/**
 * One experience value from several duplicate rows for the same player: the shared value when every
 * KNOWN value agrees, otherwise null. Two sources disagreeing is not a fact.
 */
export function mergeKnownYearsExp(values: ReadonlyArray<unknown>): number | null {
  let found: number | null = null
  for (const v of values) {
    const n = finiteNonNegative(v)
    if (n == null) continue
    if (found != null && found !== n) return null
    found = n
  }
  return found
}

export type NonNflRookieFields = {
  yearsExp?: number
  rookieYearsExpSource?: NflRookieYearsExpProvenance
  isRookie?: true
}

export function resolveNonNflRookieFields(input: {
  /** `yearsExp` already on the raw row (an upstream that supplied it). Wins. */
  rowYearsExp: unknown
  /** `experience` on the matched `SportsPlayer` pool row (`SportsPlayer.yearsExp`). */
  poolExperience: unknown
  /** `extractRookieHint` from `sports_players` stats — a heuristic, used only when experience is unknown. */
  rookieHint: boolean | null | undefined
}): NonNflRookieFields {
  const yearsExp = finiteNonNegative(input.rowYearsExp) ?? finiteNonNegative(input.poolExperience)
  if (yearsExp != null) return { yearsExp, rookieYearsExpSource: 'explicit_imported' }
  return input.rookieHint === true ? { isRookie: true } : {}
}

/**
 * Which `DevyPlayer.sport` feeds a devy/C2C league's college (prospect) layer.
 *
 * The merge used to read every `devyEligible` row regardless of sport, so an NBA devy league drew
 * football players and an NFL one drew NCAAB players. NHL and MLB have no college prospect layer in
 * any committed contract (`docs/DYNASTY_PROSPECT_DATA_PLAN.md` §2), so they get none.
 */
export function devyPoolSportForDraftSport(sport: string): 'NCAAF' | 'NCAAB' | null {
  const s = String(sport ?? '').trim().toUpperCase()
  if (s === 'NFL') return 'NCAAF'
  if (s === 'NBA') return 'NCAAB'
  return null
}

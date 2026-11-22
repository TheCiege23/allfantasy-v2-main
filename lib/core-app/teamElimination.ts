/**
 * Has this team been knocked out of its league? ONE rule for My Team's two views.
 *
 * 🛑 WHY. The cross-league board (`myTeamPulse.ts`) and the league view (`myTeam.ts`) each kept
 * their own copy, and they disagreed:
 *   - the board read the `GuillotineElimination` table and only `guillotineMode`;
 *   - the league view ignored the table but also accepted `leagueVariant`.
 * So an eliminated team could vanish from the board while its league page still offered lineup
 * swaps — or, in a league marked guillotine only through `leagueVariant`, the reverse.
 *
 * Signals, any one of which is enough:
 *   1. the provider says so on the roster (`playerData.eliminated`);
 *   2. an elimination is recorded for this owner in this league's season;
 *   3. a guillotine league (either flag) has emptied this roster — the chop releases every player.
 *
 * Pure. Callers read the rows; this only decides.
 */

import { importedGuillyFormat } from '@/lib/guillotine/importedGuillyHealth'

const GUILLOTINE_VARIANTS: ReadonlySet<string> = new Set(['guillotine', 'survivor_guillotine'])

export type EliminationLeague = {
  guillotineMode?: boolean | null
  leagueVariant?: string | null
  /** `League.leagueType` — an importer's guess unless the commissioner confirmed the type. */
  leagueType?: string | null
  /** `League.settings`, read for `leagueTypeConfirmation` only. */
  settings?: unknown
}

/**
 * ⚠ AN IMPORTED GUILLY LEAGUE SETS NEITHER NATIVE FLAG (user report, 2026-11-18). ESPN's
 * "Washington Pro Knockout" knocked its owner out in week 8, and the owner had confirmed the league
 * as Guilly — but `guillotineMode` was false and `leagueVariant` null, so My Team read the emptied
 * roster as "no starting lineup recorded" and offered Fix Lineup to a team that could not play.
 * The confirmation and the `leagueType` column are where an import says it, and Home already reads
 * them through `importedGuillyFormat` (the confirmation wins, so a league a human set back to
 * redraft stays redraft). Callers that pass neither field get the answer they always got.
 */
export function isGuillotineLeague(league: EliminationLeague): boolean {
  if (league.guillotineMode === true || GUILLOTINE_VARIANTS.has(String(league.leagueVariant ?? '').toLowerCase())) return true
  if (league.leagueType === undefined && league.settings === undefined) return false
  return importedGuillyFormat({
    leagueType: league.leagueType == null ? null : String(league.leagueType).toLowerCase(),
    guillotineMode: league.guillotineMode ?? null,
    settings: league.settings ?? null,
  }) != null
}

export function isTeamEliminated(args: {
  playerData: unknown
  league: EliminationLeague
  /** A `GuillotineElimination` row exists for this owner, this league, this season. */
  eliminationRecorded: boolean
}): boolean {
  if (args.eliminationRecorded) return true
  const pd = args.playerData && typeof args.playerData === 'object' ? (args.playerData as Record<string, unknown>) : {}
  if (pd.eliminated === true || pd.eliminated === 'true') return true
  return isGuillotineLeague(args.league) && Array.isArray(pd.players) && pd.players.length === 0
}

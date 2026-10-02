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

export const GUILLOTINE_VARIANTS: ReadonlySet<string> = new Set(['guillotine', 'survivor_guillotine'])

export function isGuillotineLeague(league: { guillotineMode?: boolean | null; leagueVariant?: string | null }): boolean {
  return league.guillotineMode === true || GUILLOTINE_VARIANTS.has(String(league.leagueVariant ?? '').toLowerCase())
}

export function isTeamEliminated(args: {
  playerData: unknown
  league: { guillotineMode?: boolean | null; leagueVariant?: string | null }
  /** A `GuillotineElimination` row exists for this owner, this league, this season. */
  eliminationRecorded: boolean
}): boolean {
  if (args.eliminationRecorded) return true
  const pd = args.playerData && typeof args.playerData === 'object' ? (args.playerData as Record<string, unknown>) : {}
  if (pd.eliminated === true || pd.eliminated === 'true') return true
  return isGuillotineLeague(args.league) && Array.isArray(pd.players) && pd.players.length === 0
}

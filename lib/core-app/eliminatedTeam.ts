/**
 * Has this team been eliminated (chopped) in an elimination league?
 *
 * ⚠ ONE RULE, TWO READERS. Game Plan's loader (gameDayTriageLoader.ts, 559c56580) decided this inline
 * to skip a chopped team's lineup; Scout now needs the same answer to mark rivals out of the league.
 * Two copies of one predicate is how this codebase keeps shipping disagreements, so both call this.
 *
 * Any one signal is enough, because each importer writes a different one:
 *   - the roster's own flag (`playerData.eliminated` / `.chopped`), from provider imports;
 *   - a `guillotine_roster_states` row with `choppedAt`, keyed by whichever id the writer had —
 *     so every id the team is known by is tried (externalId, LeagueTeam.id, Roster.id);
 *   - a `guillotine_eliminations` row for THIS season naming the team or its owner;
 *   - an elimination league whose roster has no players left at all.
 *
 * Pure and client-safe.
 */
export function isEliminatedTeam(args: {
  playerData: unknown
  /** Every id the team is known by: externalId, LeagueTeam.id, Roster.id. */
  ids: ReadonlyArray<string | null | undefined>
  /** Ids with a chopped `guillotine_roster_states` row in this league. */
  chopped: ReadonlySet<string>
  /** Ids (roster or owner) named by a `guillotine_eliminations` row for this league's season. */
  eliminated: ReadonlySet<string>
  /** The league is an elimination format (guillotine / survivor). */
  elimination: boolean
}): boolean {
  const pd = (args.playerData ?? {}) as Record<string, unknown>
  if (pd.eliminated === true || pd.chopped === true) return true
  const ids = args.ids.filter((id): id is string => Boolean(id))
  if (ids.some((id) => args.chopped.has(id))) return true
  if (ids.some((id) => args.eliminated.has(id))) return true
  /*
   * ⚠ A MISSING `players` KEY COUNTS AS EMPTY, as it always did in the loader (`… : []`). Changing
   * that while extracting would quietly change which lineups Game Plan reads.
   */
  if (args.elimination) {
    const players = Array.isArray(pd.players) ? pd.players.filter((id) => id && id !== '0') : []
    if (players.length === 0) return true
  }
  return false
}

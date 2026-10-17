/**
 * Archived leagues on /core — out of the lists, still reachable. PURE.
 *
 * A commissioner archives a league through `commissionerService.archiveLeague`, which moves
 * `League.lifecycleState` to `archived` and nothing else. Nothing on /core read that column, so an
 * archived league stayed in the rail and the scope switcher exactly like a live one.
 *
 * 🛑 HIDE, NEVER FILTER THE LEAGUE LIST. `getDashboardLeagueListForUser` → `toPlayedLeagues` is the
 * page's AUTHORIZATION boundary for `?league=` (see the page's "A league query is also an
 * authorization boundary"). Dropping archived rows there would lock every member out of the
 * league's history, by link or by hand. So the ids are merged into the hidden ids the shell already
 * honours: `withoutHidden` drops them from the rail but always keeps the SELECTED league, and every
 * "pick a league" chooser still sees them.
 *
 * ⚠ `status` IS NOT THE SIGNAL. Archiving leaves `status` as it was (a league archived in setup
 * still reads `status: 'setup'`), because `status` is written by imports and `lifecycleState` by
 * our own state machine. Lower-cased to match the other readers (`renewalPolicy.ts`,
 * `lineupLockService.ts`).
 */

export type LifecycleRow = {
  id: string
  lifecycleState?: string | null
}

export function isArchivedLeague(row: { lifecycleState?: string | null }): boolean {
  return String(row.lifecycleState ?? '').trim().toLowerCase() === 'archived'
}

export function archivedLeagueIds(rows: readonly LifecycleRow[]): string[] {
  return rows.filter(isArchivedLeague).map((row) => row.id)
}

/**
 * The account's own hidden ids plus every archived league, de-duplicated, own order first. This is
 * what the /core shell's rail and scope switcher are handed as "hidden".
 */
export function withArchivedHidden(hidden: readonly string[], rows: readonly LifecycleRow[]): string[] {
  const out = [...hidden]
  const seen = new Set(hidden)
  for (const id of archivedLeagueIds(rows)) {
    if (!seen.has(id)) {
      seen.add(id)
      out.push(id)
    }
  }
  return out
}

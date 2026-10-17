/**
 * Has this league not started yet — no draft, so no roster and no schedule to read?
 *
 * ⚠ ONE RULE, SHARED. It was written inline in the matchup board (`classifyUnplaced`, 0cb0a038f)
 * and is needed again by Chimmy's cross-league tools, which on 2026-09-28 reported six native
 * AllFantasy leagues still in setup as "a team with no players synced — the real list can only be
 * longer". A league that has not drafted has no players because nobody has drafted any, not because
 * a sync failed, and it cannot hide an injury. Two copies of the rule would drift.
 *
 * Either field may carry it: `status` is written by the importer and the setup flow,
 * `lifecycleState` by the lifecycle engine, and production holds rows where they disagree. PURE.
 */
export const NOT_STARTED_LEAGUE_STATES: ReadonlySet<string> = new Set(['setup', 'pre_draft', 'predraft', 'drafting'])

export function isLeagueNotStarted(
  league: { status?: string | null; lifecycleState?: string | null } | null | undefined,
): boolean {
  if (!league) return false
  return [league.status, league.lifecycleState].some((v) => NOT_STARTED_LEAGUE_STATES.has(String(v ?? '').toLowerCase()))
}

/**
 * Values a commissioner has SAVED this page-session, by league.
 *
 * The settings modal is fed the league from the page's server props, which nothing refreshes after
 * an autosave. So closing and reopening settings re-seeded every field from the stale props and the
 * commissioner saw their change "undone" — read as "I can't change anything" — although the PATCH
 * had succeeded. `useLeagueSettingsSectionAutosave` records each successful patch here and the tabs
 * seed from `league ⊕ overrides`. Module scope on purpose: it must outlive the modal's unmount, and
 * a full page load (fresh props) is the moment it should be forgotten.
 */
const overridesByLeague = new Map<string, Record<string, unknown>>()

export function recordSavedLeagueOverrides(leagueId: string, updates: Record<string, unknown>): void {
  if (!leagueId) return
  overridesByLeague.set(leagueId, { ...(overridesByLeague.get(leagueId) ?? {}), ...updates })
}

export function readSavedLeagueOverrides(leagueId: string | undefined | null): Record<string, unknown> {
  if (!leagueId) return {}
  return overridesByLeague.get(leagueId) ?? {}
}

/** Saved value for `key` when one exists, else `fallback`. */
export function savedOr<T>(leagueId: string | undefined | null, key: string, fallback: T): T {
  const o = readSavedLeagueOverrides(leagueId)
  return Object.prototype.hasOwnProperty.call(o, key) ? (o[key] as T) : fallback
}

/** Test hook. */
export function clearSavedLeagueOverrides(): void {
  overridesByLeague.clear()
}

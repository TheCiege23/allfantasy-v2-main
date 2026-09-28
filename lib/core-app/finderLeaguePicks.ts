/**
 * "All leagues / pick leagues" for the Player Finder (Phase 2, 2026-09-27) — the dynastyplanet
 * choice: read every league, or only the ones you tick. Saved to the ACCOUNT, not the device
 * (UserProfile.corePreferences.playerFinderLeagueIds), so the pick follows the manager from a
 * desktop at noon to a phone at 12:55.
 *
 * Pure and client-safe; the store is finderLeaguePicksStore.ts.
 *
 * ⚠ THE SAVED LIST IS ALWAYS INTERSECTED WITH THE LEAGUES THE ACCOUNT PLAYS NOW. A league left or
 * deleted since it was ticked simply drops out; an id the account never had can be stored (the
 * route does not look each one up) and can never be read, because nothing outside `played` survives.
 * And if nothing ticked survives, the finder falls back to ALL — an empty board because every
 * picked league was archived would read as "you roster nobody".
 */

export const MAX_PICKS = 300

/** Shape-check a client-sent list: distinct non-empty strings, bounded. Null clears the pick (= all). */
export function normalizePicks(input: unknown): string[] | null {
  if (input === null) return null
  if (!Array.isArray(input)) return null
  const out: string[] = []
  const seen = new Set<string>()
  for (const v of input) {
    if (typeof v !== 'string') continue
    const id = v.trim()
    if (!id || id.length > 64 || seen.has(id)) continue
    seen.add(id)
    out.push(id)
    if (out.length >= MAX_PICKS) break
  }
  return out
}

export type LeagueScope = {
  /** The leagues the finder reads, in the caller's order. */
  leagueIds: string[]
  /** True when the account's pick is in force (fewer than all). */
  picked: boolean
  /** How many of the played leagues the pick covers. */
  count: number
  total: number
}

export function resolveLeagueScope(played: readonly string[], saved: readonly string[] | null | undefined): LeagueScope {
  const total = played.length
  if (!saved || saved.length === 0) return { leagueIds: [...played], picked: false, count: total, total }
  const want = new Set(saved)
  const kept = played.filter((id) => want.has(id))
  if (kept.length === 0 || kept.length === total) return { leagueIds: [...played], picked: false, count: total, total }
  return { leagueIds: kept, picked: true, count: kept.length, total }
}

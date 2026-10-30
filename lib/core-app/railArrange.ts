import { leagueSportSections, type LeagueSportSection } from './leagueSports'

/**
 * How the league list is arranged on screen: your favorites pinned on top, the rest by sport, an
 * optional filter, and moving a league up or down. Pure and client-safe, so the rail and its tests
 * share one rule.
 *
 * ⚠ FAVORITES ARE THE ACCOUNT'S EXISTING FAVORITES (leaguePreferences.ts), NOT A NEW "PINNED" LIST.
 * The Home's Favorites scope already reads them; pinning a league in the list and starring it for
 * that scope are one act, so the two can never disagree about which leagues are yours.
 */

/** The section key the favorites block uses. Never a sport key (those are upper-case codes or null). */
export const FAVORITES_SECTION = 'favorites'

export type RailFilter = 'all' | 'live' | 'commissioner' | 'needs'
export const RAIL_FILTERS: readonly RailFilter[] = ['all', 'live', 'commissioner', 'needs']

/** The list shows filter chips from this many leagues up; below it there is nothing to narrow. */
export const RAIL_FILTER_MIN_LEAGUES = 6

export type RailRowFacts = { live: boolean; commissioner: boolean; needs: boolean }

/**
 * Favorites first, in the account's own order, then one section per sport. A hub (a connected
 * group drawn as one card) is never pinned on its own and stays in its sport.
 */
export function railSections<T extends { id: string; sport?: string | null; hub?: unknown }>(
  rows: readonly T[],
  favoriteIds: ReadonlySet<string>,
): Array<LeagueSportSection<T>> {
  const favorites = rows.filter((r) => !r.hub && favoriteIds.has(r.id))
  const rest = favorites.length ? rows.filter((r) => r.hub || !favoriteIds.has(r.id)) : [...rows]
  const sports = leagueSportSections(rest)
  return favorites.length ? [{ key: FAVORITES_SECTION, rows: favorites }, ...sports] : sports
}

/** Does a row pass the filter? A hub card has no single league's facts, so only "all" keeps it. */
export function passesRailFilter(filter: RailFilter, facts: RailRowFacts | null): boolean {
  if (filter === 'all') return true
  if (!facts) return false
  if (filter === 'live') return facts.live
  if (filter === 'commissioner') return facts.commissioner
  return facts.needs
}

export function railFilterCounts(facts: ReadonlyArray<RailRowFacts>): Record<RailFilter, number> {
  return {
    all: facts.length,
    live: facts.filter((f) => f.live).length,
    commissioner: facts.filter((f) => f.commissioner).length,
    needs: facts.filter((f) => f.needs).length,
  }
}

/**
 * The account's whole league order after moving `id` one place up or down WITHIN ITS SECTION — the
 * neighbour it trades places with is the one the reader sees next to it, never a league hidden in
 * another sport. Null when it is already at that end.
 *
 * `fullOrder` is every league id the account plays, in its current order (hidden ones included, so
 * their saved places survive); `sectionIds` is what the reader sees in that section.
 */
export function moveInOrder(
  fullOrder: readonly string[],
  sectionIds: readonly string[],
  id: string,
  direction: -1 | 1,
): string[] | null {
  const at = sectionIds.indexOf(id)
  const neighbour = sectionIds[at + direction]
  if (at < 0 || neighbour == null) return null
  const next = [...fullOrder]
  const a = next.indexOf(id)
  const b = next.indexOf(neighbour)
  if (a < 0 || b < 0) return null
  next[a] = neighbour
  next[b] = id
  return next
}

/** Favorites with `id` added or removed. Added to the end, so earlier favorites keep their places. */
export function toggleFavorite(favorites: readonly string[], id: string): string[] {
  return favorites.includes(id) ? favorites.filter((f) => f !== id) : [...favorites, id]
}

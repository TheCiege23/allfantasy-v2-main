/**
 * The account's league-list preferences for the universal My Team view — favorites, hidden leagues,
 * and a custom order. Pure and client-safe; the read/write lives in leaguePreferencesStore.ts, in
 * `UserProfile.corePreferences` (the JSONB column for Core preferences — no migration).
 *
 * ⚠ HIDDEN MEANS "OUT OF MY LISTS", NOT "OUT OF MY TOTALS". Owner's call, 2026-10-02: a hidden league
 * disappears from the rail, the league switcher and the My Leagues list, but still counts in the
 * portfolio, the "since your last visit" diff and every other aggregate on Home. Dropping it from
 * those would make Home a partial read, which turns those cards off (see `homeScoped` in the /core
 * page). And it stays in every "pick a league" chooser, so a hidden league's tools stay reachable.
 *
 * ⚠ EVERY LIST HERE IS A SET OF IDS TO INTERSECT WITH THE AUTHORIZED LEAGUE LIST, never a lookup. A
 * foreign id stored in any of them matches nothing.
 */

/** Cap per list. Far beyond any real account (the largest measured had 557 rows incl. history). */
export const LEAGUE_PREFERENCE_LIMIT = 600

export type LeaguePreferences = {
  /** Null = never saved on this account; the caller falls back to the old per-device cookie. */
  favorites: string[] | null
  hidden: string[]
  order: string[]
}

export const EMPTY_LEAGUE_PREFERENCES: LeaguePreferences = { favorites: null, hidden: [], order: [] }

/** The three keys in `corePreferences`, by field. One place, so the store and the route cannot drift. */
export const LEAGUE_PREFERENCE_KEYS = {
  favorites: 'favoriteLeagueIds',
  hidden: 'hiddenLeagueIds',
  order: 'leagueOrder',
} as const

export type LeaguePreferenceField = keyof typeof LEAGUE_PREFERENCE_KEYS

/** Distinct, non-empty, short strings, bounded — anything else in the input is dropped, not trusted. */
export function normalizeLeagueIdList(input: unknown): string[] {
  if (!Array.isArray(input)) return []
  const out: string[] = []
  const seen = new Set<string>()
  for (const v of input) {
    if (typeof v !== 'string') continue
    const id = v.trim()
    if (!id || id.length > 64 || seen.has(id)) continue
    seen.add(id)
    out.push(id)
    if (out.length >= LEAGUE_PREFERENCE_LIMIT) break
  }
  return out
}

/** Read the three keys out of a stored `corePreferences` object. */
export function readLeaguePreferences(core: unknown): LeaguePreferences {
  const obj = core && typeof core === 'object' && !Array.isArray(core) ? (core as Record<string, unknown>) : {}
  const fav = obj[LEAGUE_PREFERENCE_KEYS.favorites]
  return {
    favorites: Array.isArray(fav) ? normalizeLeagueIdList(fav) : null,
    hidden: normalizeLeagueIdList(obj[LEAGUE_PREFERENCE_KEYS.hidden]),
    order: normalizeLeagueIdList(obj[LEAGUE_PREFERENCE_KEYS.order]),
  }
}

/**
 * The list in the user's order: ids in `order` first, in that order, then everything else in its
 * original order. Stable, so a league added after the order was saved lands at the end rather than
 * jumping to the top.
 */
export function applyLeagueOrder<T extends { id: string }>(list: readonly T[], order: readonly string[]): T[] {
  if (order.length === 0) return [...list]
  const rank = new Map(order.map((id, i) => [id, i]))
  return list
    .map((item, i) => ({ item, i, r: rank.get(item.id) }))
    .sort((a, b) => {
      if (a.r !== undefined && b.r !== undefined) return a.r - b.r
      if (a.r !== undefined) return -1
      if (b.r !== undefined) return 1
      return a.i - b.i
    })
    .map((x) => x.item)
}

/**
 * The list without hidden leagues — except `keepId`, the league currently open, so hiding a league
 * never makes the page you are on vanish from its own rail.
 */
export function withoutHidden<T extends { id: string }>(
  list: readonly T[],
  hidden: readonly string[],
  keepId?: string | null,
): T[] {
  if (hidden.length === 0) return [...list]
  const set = new Set(hidden)
  return list.filter((l) => !set.has(l.id) || l.id === keepId)
}

/** Order, then hide — what every list surface applies. */
export function arrangeLeagueList<T extends { id: string }>(
  list: readonly T[],
  prefs: Pick<LeaguePreferences, 'hidden' | 'order'>,
  keepId?: string | null,
): T[] {
  return withoutHidden(applyLeagueOrder(list, prefs.order), prefs.hidden, keepId)
}

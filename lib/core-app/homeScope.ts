/**
 * The /core home's scope: which of your leagues the cross-league view is about.
 *
 * FOUR SHAPES, AND A FIFTH THAT IS NOT ONE OF THEM.
 *   all        every league you play — the default, and what an absent or unreadable value means
 *   favorites  the leagues you starred
 *   sport      every league in one sport
 *   platform   every league on one provider
 * A SINGLE league is not a scope value. It stays `?league=<id>`, because that id is an
 * authorization boundary the page checks before any loader runs (see `AfCorePage`); a second way to
 * name one league would be a second place that check has to be remembered.
 *
 * ⚠ A SCOPE ONLY EVER NARROWS THE PLAYED-LEAGUE LIST THE PAGE ALREADY AUTHORIZED. It is applied to
 * that list, never used to look anything up, so no value — however hand-written — can reach a league
 * that is not the viewer's. A sport or platform nobody plays is not an error: it matches nothing,
 * and the home says so rather than quietly showing everything.
 *
 * ⚠ FAVORITES ARE THIS DEVICE'S, FOR NOW. They live in a first-party cookie (`FAVORITES_COOKIE`)
 * so the server can scope the first paint without a table and without a new route. Cross-device
 * favorites need a column on the user's profile — a migration, which is the user's call, not this
 * module's. The cookie is only ever a set of ids to intersect with the authorized list.
 */

export type HomeScope =
  | { kind: 'all' }
  | { kind: 'favorites' }
  | { kind: 'sport'; sport: string }
  | { kind: 'platform'; platform: string }

export const HOME_SCOPE_PARAM = 'scope'
export const FAVORITES_COOKIE = 'af_core_favs'
/**
 * The filter chosen in this browser session — a session cookie (no max-age), written by the
 * switcher. Read by the server only when the URL does not name a scope.
 */
export const SCOPE_COOKIE = 'af_core_scope'
/** A cookie is ~4KB; a uuid is 36 characters. Far more than anyone stars, far less than the limit. */
export const FAVORITES_LIMIT = 60

export type ScopeLeague = {
  id: string
  name?: string | null
  sport?: string | null
  platform?: string | null
}

const TOKEN = /^[a-z0-9_-]{1,24}$/i

export function parseHomeScope(raw: string | string[] | null | undefined): HomeScope {
  const value = Array.isArray(raw) ? raw[0] : raw
  if (!value) return { kind: 'all' }
  if (value === 'fav') return { kind: 'favorites' }
  const [kind, arg] = value.split(':', 2)
  if (arg && TOKEN.test(arg)) {
    if (kind === 'sport') return { kind: 'sport', sport: arg.toUpperCase() }
    if (kind === 'platform') return { kind: 'platform', platform: arg.toLowerCase() }
  }
  return { kind: 'all' }
}

/** The URL value for a scope — null for `all`, which is the absence of the parameter. */
export function serializeHomeScope(scope: HomeScope): string | null {
  switch (scope.kind) {
    case 'all':
      return null
    case 'favorites':
      return 'fav'
    case 'sport':
      return `sport:${scope.sport.toUpperCase()}`
    case 'platform':
      return `platform:${scope.platform.toLowerCase()}`
  }
}

export function isScoped(scope: HomeScope): boolean {
  return scope.kind !== 'all'
}

export function sportOf(league: ScopeLeague): string {
  return String(league.sport ?? 'NFL').toUpperCase()
}

export function platformOf(league: ScopeLeague): string {
  return String(league.platform ?? 'manual').toLowerCase()
}

/** The leagues a scope keeps, in their original order. `all` returns the input itself. */
export function applyHomeScope<T extends ScopeLeague>(
  leagues: readonly T[],
  scope: HomeScope,
  favoriteIds: ReadonlySet<string>,
): T[] {
  switch (scope.kind) {
    case 'all':
      return leagues as T[]
    case 'favorites':
      return leagues.filter((l) => favoriteIds.has(l.id))
    case 'sport':
      return leagues.filter((l) => sportOf(l) === scope.sport)
    case 'platform':
      return leagues.filter((l) => platformOf(l) === scope.platform)
  }
}

/**
 * The favorites cookie, read defensively: only well-formed ids, only ids of leagues the viewer
 * actually plays, de-duplicated and capped. Anything else in the cookie is ignored, not trusted.
 */
export function parseFavoriteIds(raw: string | null | undefined, playedIds: Iterable<string>): Set<string> {
  const played = new Set(playedIds)
  const out = new Set<string>()
  if (!raw) return out
  let decoded = raw
  try {
    decoded = decodeURIComponent(raw)
  } catch {
    return out
  }
  for (const id of decoded.split('.')) {
    if (out.size >= FAVORITES_LIMIT) break
    if (/^[A-Za-z0-9_-]{1,64}$/.test(id) && played.has(id)) out.add(id)
  }
  return out
}

/** The cookie value for a set of favorite ids. `.` separates them — it never appears in an id. */
export function serializeFavoriteIds(ids: Iterable<string>): string {
  return [...new Set(ids)]
    .filter((id) => /^[A-Za-z0-9_-]{1,64}$/.test(id))
    .slice(0, FAVORITES_LIMIT)
    .join('.')
}

export type ScopeOption = { value: string | null; label: string; count: number; group: 'all' | 'favorites' | 'sport' | 'platform' }

const PLATFORM_LABEL: Record<string, string> = {
  espn: 'ESPN',
  mfl: 'MFL',
  nfl: 'NFL.com',
  cbs: 'CBS',
  yahoo: 'Yahoo',
  sleeper: 'Sleeper',
  fantrax: 'Fantrax',
  manual: 'AllFantasy',
  allfantasy: 'AllFantasy',
}

export function platformLabel(platform: string): string {
  const key = platform.toLowerCase()
  return PLATFORM_LABEL[key] ?? key.charAt(0).toUpperCase() + key.slice(1)
}

/**
 * The switcher's choices, built from the leagues the viewer plays — never a fixed list, so it
 * cannot offer a sport or provider the viewer has nothing in. A sport or platform group is offered
 * only when there are at least two to choose between: a filter that equals "all" is noise.
 */
export function scopeOptions(leagues: readonly ScopeLeague[], favoriteIds: ReadonlySet<string>): ScopeOption[] {
  const options: ScopeOption[] = [{ value: null, label: 'All leagues', count: leagues.length, group: 'all' }]
  const favorites = leagues.filter((l) => favoriteIds.has(l.id)).length
  options.push({ value: 'fav', label: 'Favorites', count: favorites, group: 'favorites' })

  const bySport = countBy(leagues, sportOf)
  if (bySport.size > 1) {
    for (const [sport, count] of [...bySport].sort(byCountThenName)) {
      options.push({ value: `sport:${sport}`, label: sport, count, group: 'sport' })
    }
  }
  const byPlatform = countBy(leagues, platformOf)
  if (byPlatform.size > 1) {
    for (const [platform, count] of [...byPlatform].sort(byCountThenName)) {
      options.push({ value: `platform:${platform}`, label: platformLabel(platform), count, group: 'platform' })
    }
  }
  return options
}

/** What the switcher's button says. Always a noun phrase about leagues — never blank. */
export function scopeLabel(scope: HomeScope, selectedLeagueName: string | null): string {
  if (selectedLeagueName) return selectedLeagueName
  switch (scope.kind) {
    case 'all':
      return 'All leagues'
    case 'favorites':
      return 'Favorite leagues'
    case 'sport':
      return `${scope.sport} leagues`
    case 'platform':
      return `${platformLabel(scope.platform)} leagues`
  }
}

function countBy(leagues: readonly ScopeLeague[], key: (l: ScopeLeague) => string): Map<string, number> {
  const counts = new Map<string, number>()
  for (const l of leagues) counts.set(key(l), (counts.get(key(l)) ?? 0) + 1)
  return counts
}

function byCountThenName(a: [string, number], b: [string, number]): number {
  return b[1] - a[1] || a[0].localeCompare(b[0])
}

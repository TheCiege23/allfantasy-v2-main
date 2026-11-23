/**
 * Keys inside `League.settings` that must never reach a client.
 *
 * 🛑 `psychologyCache` / `psychologyCachedAt` hold manager characterisation LABELS — an archetype,
 * trait scores, a blind spot, a negotiation style — keyed by rosterId, written by the retired
 * power-rankings "psychology" job for any manager a viewer expanded. Milestone 32 shows those labels
 * to NOBODY. The writer is gone and nothing reads the keys, but rows written before 2026-09-10 still
 * carry them, and several routes hand `League.settings` to league members wholesale.
 *
 * This is a READ-SIDE strip. It deliberately does NOT clean the stored rows: deleting data from
 * production is the owner's decision, and a route that read-modify-writes `settings` keeps whatever
 * it read, so the stored value is unchanged by anything here.
 */
const CLIENT_HIDDEN_LEAGUE_SETTINGS_KEYS = ['psychologyCache', 'psychologyCachedAt'] as const

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value)
}

/**
 * `League.settings` as a client may see it. Returns the input untouched (same reference) when it is
 * not an object or carries none of the hidden keys, so a caller never pays for a copy it did not need.
 */
export function clientLeagueSettings<T>(settings: T): T {
  if (!isPlainObject(settings)) return settings
  if (!CLIENT_HIDDEN_LEAGUE_SETTINGS_KEYS.some((k) => k in settings)) return settings
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(settings)) {
    if (!(CLIENT_HIDDEN_LEAGUE_SETTINGS_KEYS as readonly string[]).includes(k)) out[k] = v
  }
  return out as T
}

/**
 * The `League` columns the league page's sidebar reads (LeagueShell `prismaLeagueToUserLeague`).
 */
export const SIDEBAR_LEAGUE_FIELDS = [
  'id', 'name', 'platform', 'platformLeagueId', 'sport', 'leagueVariant', 'leagueType', 'isDynasty', 'scoring',
  'leagueSize', 'season', 'status', 'lifecycleState', 'avatarUrl', 'logoUrl', 'bestBallMode', 'guillotineMode',
  'keeperPhaseActive', 'playoffLowerBracket', 'isCommissioner',
] as const

/**
 * The `settings` keys the sidebar reads: the week (`weekFromLeagueSettings`) and where a row links to
 * (`lib/dashboard/league-list-destination.ts`: `tournamentId`, `league_type`). Censused 2026-11-23 across
 * every consumer of the list — rail, switcher, league list panel, Chimmy dock and chat bar.
 */
export const SIDEBAR_SETTINGS_KEYS = ['currentWeek', 'current_week', 'week', 'tournamentId', 'league_type'] as const

export type SidebarLeague<T> = Pick<T, Extract<keyof T, (typeof SIDEBAR_LEAGUE_FIELDS)[number] | 'settings'>>

/**
 * A league in the league page's sidebar list: only the columns and `settings` keys the sidebar reads.
 *
 * 🛑 The list is up to 50 leagues. Sent whole, `identity_mappings` alone was 4.4 MB of a 5.6 MB page and
 * froze Chrome (#4119); with that gone, the rest of `settings` (scoring tables, Fantrax/ESPN blobs,
 * import coverage) was still ~1 MB nothing in the sidebar reads. Adding a sidebar feature that needs
 * another key means adding it here, and the test pins the list.
 *
 * Only for a list a client READS. Never hand the result to anything that writes `settings` back.
 */
export function toSidebarLeague<T extends object>(league: T): SidebarLeague<T> {
  const row = league as Record<string, unknown>
  const out: Record<string, unknown> = {}
  for (const k of SIDEBAR_LEAGUE_FIELDS) if (k in row) out[k] = row[k]
  const settings = row.settings
  if (isPlainObject(settings)) {
    const slim: Record<string, unknown> = {}
    for (const k of SIDEBAR_SETTINGS_KEYS) if (k in settings) slim[k] = settings[k]
    out.settings = slim
  } else if ('settings' in row) {
    out.settings = settings
  }
  return out as SidebarLeague<T>
}

/** A league-shaped object with its `settings` made client-safe. Anything else passes through. */
export function withClientLeagueSettings<T>(league: T): T {
  if (!isPlainObject(league) || !('settings' in league)) return league
  const settings = clientLeagueSettings(league.settings)
  if (settings === league.settings) return league
  return { ...league, settings } as T
}

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
export const CLIENT_HIDDEN_LEAGUE_SETTINGS_KEYS = ['psychologyCache', 'psychologyCachedAt'] as const

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

/** A league-shaped object with its `settings` made client-safe. Anything else passes through. */
export function withClientLeagueSettings<T>(league: T): T {
  if (!isPlainObject(league) || !('settings' in league)) return league
  const settings = clientLeagueSettings(league.settings)
  if (settings === league.settings) return league
  return { ...league, settings } as T
}

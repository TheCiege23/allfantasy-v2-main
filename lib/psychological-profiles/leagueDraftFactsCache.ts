/**
 * Dependency-free on purpose: the league refresh loops import it, and pulling the aggregator in
 * with it would drag the sport-scope and calibration modules into every importer.
 */
export type LeagueDraftFactRow = { playerId: string; round: number; managerId: string | null }

/**
 * League-wide draft data, read once per league refresh instead of once per manager.
 *
 * Every manager's signals compare against the WHOLE league's picks (see the comment at the read),
 * so a refresh of a 12-team league read the same `dw_draft_facts` rows, and the same player
 * positions for them, 12 times over (78k reads returning 41M rows in 9.7 days, measured
 * 2026-10-24). A refresh creates one of these and passes it to every manager in the league.
 *
 * ⚠ KEYED ON THE FULL WHERE CLAUSE (league, sport, season), so a cache handed to the wrong league
 * reads that league's rows rather than serving another's. It lives only as long as the refresh
 * that created it; nothing here is process-wide, so a later refresh always reads fresh data.
 */
export type LeagueDraftFactsCache = {
  facts: Map<string, Promise<LeagueDraftFactRow[]>>
  positions: Map<string, Promise<Map<string, string>>>
}

export function createLeagueDraftFactsCache(): LeagueDraftFactsCache {
  return { facts: new Map(), positions: new Map() }
}

export function cached<T>(map: Map<string, Promise<T>> | undefined, key: string, load: () => Promise<T>): Promise<T> {
  if (!map) return load()
  const hit = map.get(key)
  if (hit) return hit
  const pending = load()
  map.set(key, pending)
  // A failed read is not kept: the next manager retries, exactly as it did without the cache.
  pending.catch(() => {
    if (map.get(key) === pending) map.delete(key)
  })
  return pending
}

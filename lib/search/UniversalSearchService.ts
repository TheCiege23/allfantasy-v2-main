/**
 * UniversalSearchService — orchestrates search: quick actions + static results + optional API (leagues/players).
 */

import { filterQuickActionsByQuery } from "./QuickActionsService"
import {
  dedupeSearchResults,
  groupResultsByCategory,
  mapLeagueSearchHitsToResults,
  mapPlayerSearchHitsToResults,
  resolveStaticResults,
  type LeagueSearchApiHit,
  type PlayerSearchApiHit,
  type SearchResultItem,
} from "./SearchResultResolver"
import { resolveSportFilter, type SportFilterValue } from "./SportSearchFilterResolver"

export interface UniversalSearchPayload {
  query: string
  quickActions: ReturnType<typeof filterQuickActionsByQuery>
  staticResults: SearchResultItem[]
  /** When true, client can call league/player APIs for live results. */
  suggestLiveSearch: boolean
}

export interface UniversalLiveResults {
  leagues: SearchResultItem[]
  players: SearchResultItem[]
  hasError?: boolean
}

export interface UniversalLiveSearchOptions {
  sportFilter?: SportFilterValue
  limit?: number
  signal?: AbortSignal
  fetchImpl?: typeof fetch
}

/** Build search payload from query. Quick actions when empty/short; static results when query length >= 2. */
export function getUniversalSearchPayload(query: string): UniversalSearchPayload {
  const q = normalizeSearchQuery(query)
  const quickActions = filterQuickActionsByQuery(q)
  const staticResults = shouldRunLiveSearch(q) ? resolveStaticResults(q) : []
  const suggestLiveSearch = shouldRunLiveSearch(q)
  return {
    query: q,
    quickActions,
    staticResults,
    suggestLiveSearch,
  }
}

/** Group static results for UI (pages vs tools). */
export function getGroupedStaticResults(staticResults: SearchResultItem[]) {
  return groupResultsByCategory(staticResults)
}

export function normalizeSearchQuery(query: string): string {
  return query.trim().slice(0, 100)
}

export function shouldRunLiveSearch(query: string): boolean {
  return normalizeSearchQuery(query).length >= 2
}

export async function getUniversalLiveResults(
  query: string,
  options?: UniversalLiveSearchOptions
): Promise<UniversalLiveResults> {
  const normalizedQuery = normalizeSearchQuery(query)
  if (!shouldRunLiveSearch(normalizedQuery)) {
    return { leagues: [], players: [] }
  }

  const fetchImpl = options?.fetchImpl ?? fetch
  const sport = resolveSportFilter(options?.sportFilter ?? null)
  const limit = Math.min(Math.max(options?.limit ?? 6, 1), 10)

  const leagueParams = new URLSearchParams({
    q: normalizedQuery,
    limit: String(limit),
  })
  if (sport) {
    leagueParams.set("sport", sport)
  }

  const playerParams = new URLSearchParams({
    q: normalizedQuery,
    limit: String(limit),
  })
  if (sport) {
    playerParams.set("sport", sport)
  }

  const [leagueResponse, playerResponse] = await Promise.all([
    fetchImpl(`/api/league/search?${leagueParams.toString()}`, {
      method: "GET",
      cache: "no-store",
      signal: options?.signal,
    }).catch(() => null),
    fetchImpl(`/api/players/search?${playerParams.toString()}`, {
      method: "GET",
      cache: "no-store",
      signal: options?.signal,
    }).catch(() => null),
  ])

  const leagueHits = await parseLeagueHits(leagueResponse)
  const playerHits = await parsePlayerHits(playerResponse)
  const hasError =
    !leagueResponse ||
    !playerResponse ||
    !leagueResponse.ok ||
    !playerResponse.ok

  const result: UniversalLiveResults = {
    leagues: mapLeagueSearchHitsToResults(leagueHits),
    players: mapPlayerSearchHitsToResults(playerHits),
  }
  if (hasError) {
    result.hasError = true
  }
  return result
}

async function parseLeagueHits(response: Response | null): Promise<LeagueSearchApiHit[]> {
  if (!response || !response.ok) return []
  const data = (await response.json().catch(() => null)) as
    | { hits?: LeagueSearchApiHit[] }
    | null
  if (!data?.hits || !Array.isArray(data.hits)) return []
  return data.hits
}

async function parsePlayerHits(response: Response | null): Promise<PlayerSearchApiHit[]> {
  if (!response || !response.ok) return []
  const data = (await response.json().catch(() => null)) as PlayerSearchApiHit[] | null
  if (!Array.isArray(data)) return []
  return data
}

export function mergeSearchResults(
  staticResults: SearchResultItem[],
  liveResults: UniversalLiveResults
): SearchResultItem[] {
  return dedupeSearchResults([...liveResults.leagues, ...liveResults.players, ...staticResults])
}

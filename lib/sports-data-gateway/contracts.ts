/**
 * Fantasy OS Phase 5 — canonical, provider-neutral sports-data contracts.
 *
 * These shapes are independent of Sleeper / ESPN / Yahoo / Rolling Insights / TheSportsDB / CFBD / API-Sports.
 * Provider-specific fields are transformed inside adapters and must NEVER leak past this boundary. Every
 * canonical record carries source provenance; every gateway response carries a freshness context.
 */

/** Per-record (and optionally per-field) provenance, so the OS can always explain where data came from. */
export type SourceProvenance = {
  primaryProvider: string
  providerRecordId: string
  fetchedAt: string
  sourceUpdatedAt: string | null
  snapshotVersion: string
  /** Field-level provenance when a record blends multiple providers (e.g. identity from A, injury from B). */
  fields?: Record<string, { provider: string; fetchedAt: string }>
}

export type CanonicalPlayer = {
  canonicalPlayerId: string
  sport: string
  providerIds: Record<string, string>
  firstName: string
  lastName: string
  displayName: string
  position: string | null
  positions: string[]
  teamId: string | null
  status: string | null
  injuryStatus: string | null
  active: boolean
  metadata: Record<string, unknown>
  source: SourceProvenance
}

export type CanonicalTeam = {
  canonicalTeamId: string
  sport: string
  providerIds: Record<string, string>
  name: string
  abbreviation: string
  city: string | null
  conference: string | null
  division: string | null
  logoUrl: string | null
  source: SourceProvenance
}

export type CanonicalGame = {
  canonicalGameId: string
  sport: string
  season: string
  weekOrRound: string | null
  homeTeamId: string
  awayTeamId: string
  scheduledStart: string
  status: string
  venue: string | null
  score: { home: number | null; away: number | null }
  source: SourceProvenance
}

export type CanonicalPlayerAvailability = {
  canonicalPlayerId: string
  gameId: string | null
  designation: string | null
  practiceStatus: string | null
  injuryDescription: string | null
  expectedAvailability: string | null
  updatedAt: string
  source: SourceProvenance
}

export type CanonicalStatLine = {
  canonicalPlayerId: string
  gameId: string | null
  season: string
  period: string
  stats: Record<string, number | null>
  source: SourceProvenance
}

export type CanonicalProjection = {
  canonicalPlayerId: string
  gameId: string | null
  scoringContextId: string | null
  projectedStats: Record<string, number | null>
  projectedFantasyPoints: number | null
  generatedAt: string
  modelOrProviderVersion: string
  source: SourceProvenance
}

/** Freshness envelope every subsystem response carries when provider data influences the result. */
export type SportsDataFreshnessStatus = 'current' | 'delayed' | 'partial' | 'unavailable'
export type SportsDataContext = {
  generatedAt: string
  lastSuccessfulSyncAt: string | null
  sourceProviders: string[]
  snapshotVersions: string[]
  freshnessStatus: SportsDataFreshnessStatus
  limitations: string[]
}

/** Canonical schedule/game (Phase 5D-b), independent of ESPN/RollingInsights/API-Sports shapes. */
export type CanonicalGameStatus = 'scheduled' | 'delayed' | 'postponed' | 'suspended' | 'live' | 'final' | 'cancelled' | 'unknown'
export type CanonicalGameSchedule = {
  canonicalGameId: string
  sport: string
  season: string
  weekOrRound: string | null
  homeTeamId: string
  awayTeamId: string
  scheduledStart: string
  status: CanonicalGameStatus
  venue: string | null
  source: SourceProvenance
}

/**
 * Canonical player-game statistics (Phase 5F-a), provider-neutral. Real observed stats only — NO derived
 * fantasy points and NO projections. `statCategories` holds normalized numeric stat lines exactly as reported.
 * `identityResolution` records whether the provider athlete resolved to a canonical player id.
 */
export type CanonicalPlayerGameStat = {
  canonicalPlayerId: string
  canonicalGameId: string
  teamId: string
  opponentTeamId: string | null
  season: string
  week: string | null
  gameStatus: CanonicalGameStatus
  position: string | null
  statCategories: Record<string, number>
  /**
   * Phase 5F-b: identity classification. `resolved` = deterministic direct provider-id match (only these are
   * eligible for future scoring migration). `ambiguous` = a non-deterministic (e.g. name) match exists but is
   * not trusted; no canonical id is assigned. `unresolved` = no match. Never name-guessed into `resolved`.
   */
  identityResolution: 'resolved' | 'unresolved' | 'ambiguous'
  source: SourceProvenance
}

/** Canonical event envelope for incremental OS reactions. Event ids are deterministic for dedup. */
export type SportsDataEvent<T> = {
  eventId: string
  eventType: string
  sport: string
  entityId: string
  occurredAt: string
  observedAt: string
  sourceProvider: string
  snapshotVersion: string
  payload: T
}

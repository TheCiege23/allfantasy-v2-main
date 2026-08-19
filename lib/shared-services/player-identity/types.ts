/**
 * Canonical Player Identity Resolution — Fantasy OS, Phase 14.
 *
 * Reuses `ImportProvider` from `lib/league-import/types` rather than redefining
 * the provider list (same convention as `lib/shared-services/identity/types.ts`).
 */

import type { ImportProvider } from '@/lib/league-import/types'

/**
 * A reference to a player as known to one provider, before resolution. Never a
 * canonical/internal id — that's the resolver's job to produce.
 */
export interface ProviderPlayerRef {
  provider: ImportProvider
  /** The provider's own player id, e.g. a raw Sleeper numeric-string id. Omit when only a name is known. */
  sourceId?: string | null
  nameHint?: string | null
  positionHint?: string | null
  teamHint?: string | null
  sport?: string
}

/**
 * Real, computed confidence tiers — never a fabricated finer-grained score.
 * - `direct`: matched a provider-specific id column on an authoritative table.
 * - `name_match_confident`: normalized-name match with exactly one best-scoring
 *   candidate (reuses the disambiguation scoring already proven in
 *   `lib/unified-player-service.ts`'s `disambiguateCandidate`).
 * - `name_match_ambiguous`: normalized-name match, but multiple candidates tied
 *   for best score — a best-guess candidate is still returned (never silently
 *   dropped) but callers should treat it with caution.
 * - `unresolved`: no candidate found by any strategy. Explicit, never silently
 *   coerced into a guessed match.
 */
export type ResolutionConfidence = 'direct' | 'name_match_confident' | 'name_match_ambiguous' | 'unresolved'

/** Which real strategy actually produced the match — for observability, not guessing. */
export type ResolutionSource =
  | 'player_identity_map_direct'
  | 'sports_player_direct'
  | 'player_identity_map_name_match'
  | 'alias_map'
  | 'cache'
  | 'unresolved'

export interface CanonicalPlayer {
  /** `PlayerIdentityMap.id` — the canonical, cross-provider player UUID. */
  canonicalPlayerId: string
  canonicalName: string
  normalizedName: string
  position: string | null
  team: string | null
  sport: string
  /** Every provider id already known for this canonical player, where stored. Never fabricated for unsupported providers (see ProviderAdapters). */
  providerIds: Partial<Record<ImportProvider, string | null>>
}

export interface IdentityDiagnostics {
  /** The specific column/table that produced a direct match, or null otherwise. */
  matchedField: string | null
  /** How many name-match candidates were found before disambiguation. */
  candidateCount: number
  /** How many candidates tied for the best disambiguation score (1 = unambiguous). */
  tiedCandidates: number
  /** Short, human-readable explanation — never blank for an unresolved result. */
  reason: string
}

export interface ResolutionResult {
  input: ProviderPlayerRef
  player: CanonicalPlayer | null
  confidence: ResolutionConfidence
  source: ResolutionSource
  /** When this result was computed — real wall-clock time, not a fabricated freshness claim. */
  resolvedAt: string
  diagnostics: IdentityDiagnostics
}

/** A provider's real, current direct-id resolution capability — never assumed. */
export interface ProviderCapability {
  provider: ImportProvider
  /** Tables/columns tried, in order, for a direct-id match. Empty means no direct-id path exists today. */
  directIdSources: Array<{ table: 'PlayerIdentityMap' | 'SportsPlayer'; column: string }>
  /** True only when at least one directIdSources entry exists. */
  supportsDirectId: boolean
}

/**
 * Optional, injectable historical-alias resolver. No persisted alias store
 * exists in this schema today (confirmed during the Phase 14 audit) — the
 * default resolver receives an empty alias map. This is a real extension
 * point, not a fabricated "aliases work" claim.
 */
export type AliasMap = Record<string, string> // normalizedAliasName -> canonicalPlayerId

/**
 * Fantasy OS Phase 5 — canonical identity resolution (Part 4).
 *
 * Canonical ids are NEVER replaced by provider ids. Resolution is deterministic and outcome-explicit; players
 * are NEVER merged on display name alone. Ambiguous/conflicting records are quarantined, not silently merged.
 * This layer is intentionally decoupled from any specific store so it can front the existing player-identity
 * infrastructure (e.g. PlayerIdentityMap / lib/shared-services/player-identity) via the injected `MappingSource`.
 */
export type ResolutionStatus = 'resolved' | 'ambiguous' | 'unresolved' | 'conflicting'

export type IdentityEvidence = {
  provider: string
  providerId: string
  sport: string
  team?: string | null
  position?: string | null
  birthDate?: string | null
  displayName?: string | null
}

export type ResolutionResult = {
  status: ResolutionStatus
  canonicalPlayerId: string | null
  matchedBy: string[]
  candidates: string[]
  reason: string
}

/** A previously-certified mapping source: provider+id → canonical id, plus candidate lookup by weak signals. */
export interface MappingSource {
  /** Exact certified mapping (provider,id) → canonicalId. The strongest, always-trusted signal. */
  byProviderId(provider: string, providerId: string, sport: string): string | null
  /** Candidate canonical ids matching weak signals (name+team+position); may return 0, 1, or many. */
  candidatesBySignals(ev: IdentityEvidence): string[]
}

/**
 * Resolve one provider record to a canonical player id.
 *  - Certified provider-id mapping → resolved.
 *  - Exactly one weak-signal candidate (name+team+position agree) → resolved.
 *  - Multiple candidates → ambiguous (quarantine).
 *  - Zero candidates → unresolved (quarantine; never invent a canonical id).
 * Name-only matches are never sufficient.
 */
export function resolveIdentity(ev: IdentityEvidence, source: MappingSource): ResolutionResult {
  const certified = source.byProviderId(ev.provider, ev.providerId, ev.sport)
  if (certified) {
    return { status: 'resolved', canonicalPlayerId: certified, matchedBy: ['certified_provider_id'], candidates: [certified], reason: 'exact certified provider-id mapping' }
  }

  // Weak signals require MORE than a name — demand team or position corroboration.
  const hasCorroboration = Boolean(ev.team || ev.position || ev.birthDate)
  if (!hasCorroboration) {
    return { status: 'unresolved', canonicalPlayerId: null, matchedBy: [], candidates: [], reason: 'name-only evidence is insufficient (no team/position/birthdate)' }
  }

  const candidates = [...new Set(source.candidatesBySignals(ev))]
  if (candidates.length === 1) {
    return { status: 'resolved', canonicalPlayerId: candidates[0], matchedBy: ['sport', ev.team ? 'team' : '', ev.position ? 'position' : '', ev.birthDate ? 'birthDate' : ''].filter(Boolean), candidates, reason: 'single corroborated candidate' }
  }
  if (candidates.length > 1) {
    return { status: 'ambiguous', canonicalPlayerId: null, matchedBy: [], candidates, reason: `${candidates.length} candidates — quarantined, not merged` }
  }
  return { status: 'unresolved', canonicalPlayerId: null, matchedBy: [], candidates: [], reason: 'no candidate matched the corroborating signals' }
}

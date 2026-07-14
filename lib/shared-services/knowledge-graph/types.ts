/**
 * Fantasy Knowledge Graph — foundation types, Fantasy OS Migration Plan
 * Milestone 3 (docs/os/ALLFANTASY_FANTASY_OS_MIGRATION_PLAN.md), scoped per
 * the Knowledge Graph spec's own Part 15 Phase 1 build order
 * (docs/os/ALLFANTASY_FANTASY_KNOWLEDGE_GRAPH_SPEC.md).
 *
 * Implements exactly two derivations this phase: ManagerBehaviorProfile and
 * PlayerExposure — see that file's README for what's deliberately deferred.
 */

/** A manager's stable cross-league identifier. Today this is `Roster.platformUserId` — the same field Trade/Waiver already key on. Not a new identity concept; see the Identity Service (Phase 1) for the broader FantasyUser model this will eventually reconcile with. */
export type ManagerKey = string

export type SignalType =
  | 'trade_accepted'
  | 'trade_rejected'
  | 'trade_cancelled'
  | 'trade_vetoed'
  | 'waiver_claim_won'
  | 'waiver_claim_lost'

export interface SourceAttribution {
  /** Where this fact came from — 'af_native' for the native Trade/Waiver engines this phase hooks into. Future phases hooking imported-league events would use the provider name (e.g. 'sleeper'). */
  source: 'af_native' | 'sleeper' | 'espn' | 'yahoo' | 'mfl' | 'fantrax' | 'fleaflicker'
  /** The real emission point this signal was captured from — traceable back to actual code, not a guess. */
  emittedFrom: string
  recordedAt: Date
}

/** An immutable, atomic, append-only fact — never interpreted at capture time. See the Knowledge Graph spec Part 4. */
export interface Signal {
  id: string
  signalType: SignalType
  leagueId: string
  managerKey: ManagerKey
  occurredAt: Date
  /** Signal-specific detail (tradeId, claimId, playerIds, faab amounts, etc.) — this is the evidence a derived aggregate cites back to. */
  payload: Record<string, unknown>
  sourceAttribution: SourceAttribution
}

/**
 * The standard wrapper every derived output carries — Knowledge Graph spec
 * Part 8. Required on every aggregate this phase produces; never optional.
 */
export interface ConfidenceEnvelope {
  /** 0..1 — how much evidence supports this derivation. */
  confidence: number
  /** How long ago this specific version was computed, and whether the underlying signals have changed since. */
  freshness: {
    computedAt: Date
    /** True when a new signal has arrived since this version was computed — the version is still returned (immutable), but a caller knows a fresher one may exist. */
    isStale: boolean
  }
  /** The specific signals that drove this derivation — never a black-box number with no citation. */
  evidence: Array<{ signalId: string; signalType: SignalType }>
  /** Count of underlying signals/leagues contributing — the privacy gate reads this directly. */
  sampleSize: number
  sourceAttribution: SourceAttribution[]
  /** How much this could be wrong, distinct from confidence — 0..1. */
  risk: number
  /** A band around the point value, where applicable. Null when the underlying metric has no natural interval (e.g. a plain count). */
  uncertainty: { low: number; high: number } | null
}

/** as_of/computed_at versioning per the Knowledge Graph spec Part 7 — never overwritten, every recomputation is a new version. */
export interface VersionedDerivation<T> {
  /** The point in time this value describes. */
  asOf: Date
  /** When this specific version was computed — may be later than asOf. */
  computedAt: Date
  value: T
  confidenceEnvelope: ConfidenceEnvelope
}

export interface ManagerBehaviorMetrics {
  tradeCount: number
  tradeAcceptedCount: number
  tradeRejectedCount: number
  tradeCancelledCount: number
  tradeVetoedCount: number
  /** null when tradeCount is 0 — never a fabricated 0% acceptance rate for a manager with no trade history. */
  tradeAcceptRate: number | null
  waiverClaimCount: number
  waiverWonCount: number
  waiverLostCount: number
  /** null when waiverClaimCount is 0. */
  waiverWinRate: number | null
}

export type ManagerBehaviorProfile = VersionedDerivation<ManagerBehaviorMetrics>

export interface PlayerExposureMetrics {
  playerId: string
  /** How many of this manager's rosters (across every league they're in) currently carry this player. */
  rosteredInLeagueCount: number
  /** Total leagues this manager participates in — the denominator. */
  totalLeagueCount: number
  /** rosteredInLeagueCount / totalLeagueCount, 0 when totalLeagueCount is 0. */
  exposureShare: number
}

export type PlayerExposure = VersionedDerivation<PlayerExposureMetrics>

/** Who is asking — governs the privacy gate. Foundation phase has no real caller/auth wiring yet (see README); every Query Service function takes this explicitly so the gate is testable without it. */
export type QueryVisibility = 'own' | 'commissioner' | 'aggregate'

export interface PrivacyGateResult {
  allowed: boolean
  reason: string | null
  cohortSize: number
  threshold: number
}

/**
 * User OS League-Specific Intelligence Wiring phase — shared helpers used by
 * every domain generator. No domain logic lives here — only the plumbing
 * that keeps recommendations honest and IDs stable across refreshes.
 */
import type {
  CommissionerScope,
  CopyReadyContent,
  GovernanceSeverity,
  LeagueRecommendation,
  LeagueRecommendationDomain,
  PublicationAudience,
  PublicationChannel,
  RecommendationEvidence,
  RecommendationExecutionCapability,
  RecommendationStatus,
} from './types'
import type { SyncFreshness } from './types'

/**
 * Deterministic, not hashed — the same real inputs (league, domain, type,
 * and a domain-specific key like a player id) always produce the same
 * string, so refreshing the recommendation feed never creates a duplicate
 * for an unchanged condition. Never includes a timestamp or random value.
 */
export function buildRecommendationId(parts: {
  leagueId: string
  domain: LeagueRecommendationDomain
  type: string
  key: string
}): string {
  return [parts.domain, parts.type, parts.leagueId, parts.key].join(':')
}

export interface BuildRecommendationInput {
  leagueId: string
  teamId?: string
  rosterId?: string
  domain: LeagueRecommendationDomain
  type: string
  /** Used both as part of the deterministic id and to disambiguate multiple recommendations of the same type. */
  key: string
  priority: LeagueRecommendation['priority']
  title: string
  summary: string
  rationale: string[]
  evidence: RecommendationEvidence[]
  playerIds?: string[]
  relatedTeamIds?: string[]
  confidence?: number
  sourceFreshness: SyncFreshness
  executionCapability: RecommendationExecutionCapability
  action?: LeagueRecommendation['action']
  expiresAt?: string
  generatedAt: string
  /** Commissioner-only fields (Part 14) — undefined for every other domain. */
  commissionerScope?: CommissionerScope
  affectedTeamIds?: string[]
  affectedManagerIds?: string[]
  publicationAudience?: PublicationAudience
  publicationChannel?: PublicationChannel
  humanReviewRequired?: boolean
  governanceSeverity?: GovernanceSeverity
  copyReadyContent?: CopyReadyContent[]
  sourceHistoryConfidence?: 'complete' | 'partial' | 'unknown'
}

export function buildRecommendation(input: BuildRecommendationInput): LeagueRecommendation {
  return {
    id: buildRecommendationId(input),
    leagueId: input.leagueId,
    teamId: input.teamId,
    rosterId: input.rosterId,
    domain: input.domain,
    type: input.type,
    priority: input.priority,
    title: input.title,
    summary: input.summary,
    rationale: input.rationale,
    evidence: input.evidence,
    playerIds: input.playerIds,
    relatedTeamIds: input.relatedTeamIds,
    confidence: input.confidence,
    generatedAt: input.generatedAt,
    expiresAt: input.expiresAt,
    sourceFreshness: input.sourceFreshness,
    executionCapability: input.executionCapability,
    action: input.action,
    status: 'new' as RecommendationStatus,
    commissionerScope: input.commissionerScope,
    affectedTeamIds: input.affectedTeamIds,
    affectedManagerIds: input.affectedManagerIds,
    publicationAudience: input.publicationAudience,
    publicationChannel: input.publicationChannel,
    humanReviewRequired: input.humanReviewRequired,
    governanceSeverity: input.governanceSeverity,
    copyReadyContent: input.copyReadyContent,
    sourceHistoryConfidence: input.sourceHistoryConfidence,
  }
}

/**
 * Freshness gate (Part 15). A recommendation whose evidence depends on data
 * older than this is either suppressed entirely (returns `true`, caller
 * drops it) or must be visibly downgraded — never issued as if the data
 * were current. `stale`/`failed`/`never_synced` all block a *critical*
 * claim; only `fresh` data may back a `critical` priority recommendation.
 */
export function isFreshnessSafeForPriority(
  freshness: SyncFreshness,
  priority: LeagueRecommendation['priority']
): boolean {
  if (freshness.state === 'fresh' || freshness.state === 'not_applicable') return true
  if (priority === 'critical' || priority === 'high') return false
  return true
}

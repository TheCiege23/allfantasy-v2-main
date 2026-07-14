/**
 * Universal League Hub — canonical, provider-agnostic types.
 *
 * These types are the single normalized shape every downstream OS module
 * (User OS, Commissioner OS, Trade OS, Waiver OS, Lineup OS, Rankings,
 * Chimmy) should consume instead of re-deriving its own provider-aware
 * league shape. Nothing here duplicates `ImportProvider` or the
 * commissioner-gate classification — both are imported from
 * `lib/league-import/*` directly.
 */
import type { ImportProvider } from '@/lib/league-import/types'

/**
 * Every provider a league can originate from, including AllFantasy's own
 * native leagues. Widened with `| string`, mirroring the existing
 * `UserLeague.platform` convention (`app/dashboard/types.ts`) — a small
 * number of legacy rows carry platform strings outside the six certified
 * `ImportProvider`s (e.g. `'cbs'`, never a real certified import path in
 * this program). Those get honestly minimal capabilities, never a
 * fabricated `'allfantasy'`/native label. See `providerCapabilities.ts`.
 */
export type LeagueHubProvider = ImportProvider | 'allfantasy' | (string & {})

/**
 * How this league's data reaches AllFantasy. Distinct from `LeagueHubProvider`
 * (which is *who*) — this is *how*. Never overstated: a provider with no
 * live API (Fantrax) can never be `live_sync`, and a native league is never
 * `csv_snapshot` or `read_only`.
 */
export type LeagueImportType = 'native' | 'live_sync' | 'read_only' | 'csv_snapshot'

/**
 * Truthful, real capability badges. Derived, never asserted — see
 * `providerCapabilities.ts`. A provider only gets `commissioner_verified`
 * when a real API proved `isCommissioner === true` (Sleeper only, today);
 * `membership_verified` means real membership was proven but commissioner
 * status could not be (MFL/ESPN/Yahoo, post Import Security Closure phase);
 * `user_attested` means the claim is honest but unprovable from the source
 * (Fantrax, or MFL/ESPN/Yahoo after a real attestation was recorded).
 */
export type ProviderCapabilityBadge =
  | 'native'
  | 'live_sync'
  | 'read_only'
  | 'csv_snapshot'
  | 'manual_refresh'
  | 'commissioner_verified'
  | 'membership_verified'
  | 'user_attested'

export type SyncFreshnessState =
  /** Native AllFantasy leagues — there is nothing external to sync. */
  | 'not_applicable'
  | 'fresh'
  | 'stale'
  | 'syncing'
  | 'failed'
  | 'never_synced'

export interface SyncFreshness {
  state: SyncFreshnessState
  /** Real `League.lastSyncedAt` (or the legacy Sleeper-table equivalent). Never invented. */
  lastSyncedAt: string | null
}

export interface LeagueHubTeamRecord {
  wins: number
  losses: number
  ties: number
}

export interface LeagueHubUserTeam {
  /** `LeagueTeam.id` (canonical) — null when the viewer has no claimed team on this league row. */
  id: string | null
  name: string | null
  record: LeagueHubTeamRecord | null
  /** `LeagueTeam.currentRank` — real, provider-synced standing. Null when unavailable. */
  standingsPosition: number | null
}

export type CommissionerVerificationMethod = 'api' | 'attestation' | 'membership-only' | null

export interface LeagueHubCommissionerStatus {
  isCommissioner: boolean
  /** How that status was established — mirrors `League.settings.commissionerVerification.method`. */
  verificationMethod: CommissionerVerificationMethod
}

// ── Recommendation contract ────────────────────────────────────────────────────
//
// Originally defined empty (League Hub Foundation phase). Extended, not
// replaced, by the User OS League-Specific Intelligence Wiring phase — the
// same one contract every domain generator (lineup/waiver/trade/roster/
// playoff/strategy) and the future Commissioner OS populate. `commissioner`
// stays in the bundle and stays empty this phase (reserved for the named
// "Next Major Work" successor phase) — removing it would be a breaking
// change to a contract other code may already destructure by key.

export type LeagueRecommendationDomain =
  | 'lineup'
  | 'waiver'
  | 'trade'
  | 'roster'
  | 'playoff'
  | 'strategy'
  | 'commissioner'

/** One evidence item backing a recommendation's rationale — real data, never a bare claim. */
export interface RecommendationEvidence {
  label: string
  detail: string
  /** Where this evidence came from, e.g. "InjuryReportRecord", "LeagueTeam.wins" — for audit/debugging, not shown verbatim to the user. */
  source?: string
}

export type RecommendationExecutionCapability =
  /** AllFantasy can directly perform the action (native leagues only, and only for actions this phase actually wires). */
  | 'native_execute'
  /** The user must act on the external provider's own site/app — AllFantasy never claims to have done it for them. */
  | 'open_provider'
  /** AllFantasy can prefill/copy the action details for the user to paste elsewhere. */
  | 'copy_action'
  /** Informational only — no action path exists yet. */
  | 'recommendation_only'

export type RecommendationStatus = 'new' | 'viewed' | 'accepted' | 'dismissed' | 'completed' | 'expired'

export interface RecommendationAction {
  label: string
  href?: string
  payloadType?: string
}

/**
 * Commissioner OS phase — additive fields, only present on `domain: 'commissioner'`
 * recommendations. Kept on the same `LeagueRecommendation` type (per the
 * explicit instruction not to create a second recommendation contract)
 * rather than a parallel `CommissionerRecommendation` interface.
 */
export type CommissionerScope = 'league_wide' | 'single_manager' | 'single_matchup' | 'single_trade' | 'single_draft'
export type PublicationAudience = 'commissioner_only' | 'league_wide' | 'specific_managers'
export type PublicationChannel = 'league_chat' | 'discord' | 'email' | 'newsletter' | 'social_caption' | 'in_app_only'
export type GovernanceSeverity = 'none' | 'advisory' | 'review_recommended' | 'rule_violation_confirmed'

export interface CopyReadyContent {
  channel: PublicationChannel
  text: string
  characterCount: number
  characterLimit: number | null
  /** True only when generation actually ran and produced this text — false means no copy-ready variant exists for this channel yet. */
  available: boolean
}

export interface LeagueRecommendation {
  /** Deterministic — same real inputs always produce the same id, so a refresh never duplicates an unchanged recommendation. See `buildRecommendationId` in `userOsRecommendations.ts`. */
  id: string
  leagueId: string
  teamId?: string
  rosterId?: string
  domain: LeagueRecommendationDomain
  /** A specific, stable sub-type within the domain, e.g. 'injured_starter', 'empty_slot', 'positional_need' — see `docs/os/USER_OS_DOMAIN_SUPPORT_MATRIX.md` for the real, current set. */
  type: string
  priority: 'critical' | 'high' | 'medium' | 'low'
  title: string
  summary: string
  /** Ordered, human-readable reasons — the "why," always traceable to `evidence`. */
  rationale: string[]
  evidence: RecommendationEvidence[]
  playerIds?: string[]
  relatedTeamIds?: string[]
  /** 0-1. Omitted (not defaulted to a number) when this recommendation has no real confidence signal to report. */
  confidence?: number
  generatedAt: string
  expiresAt?: string
  /** Reused, not duplicated — the same `SyncFreshness` shape every League Hub surface already uses. */
  sourceFreshness: SyncFreshness
  executionCapability: RecommendationExecutionCapability
  action?: RecommendationAction
  status: RecommendationStatus
  /** Commissioner-only fields (Part 14) — undefined for every other domain. */
  commissionerScope?: CommissionerScope
  affectedTeamIds?: string[]
  affectedManagerIds?: string[]
  publicationAudience?: PublicationAudience
  publicationChannel?: PublicationChannel
  /** True when a governance condition genuinely warrants commissioner review — never set from a mere value/statistical imbalance alone. */
  humanReviewRequired?: boolean
  governanceSeverity?: GovernanceSeverity
  copyReadyContent?: CopyReadyContent[]
  /** How much real historical data backs a history-dependent claim (rivalry/storyline) — distinct from `confidence`, which is about the current signal's reliability, not the historical record's completeness. */
  sourceHistoryConfidence?: 'complete' | 'partial' | 'unknown'
}

export interface LeagueRecommendationBundle {
  lineup: LeagueRecommendation[]
  waiver: LeagueRecommendation[]
  trade: LeagueRecommendation[]
  roster: LeagueRecommendation[]
  playoff: LeagueRecommendation[]
  strategy: LeagueRecommendation[]
  commissioner: LeagueRecommendation[]
  totalCount: number
}

// ── The canonical league entry ────────────────────────────────────────────────

export interface LeagueHubEntry {
  /** Canonical `League.id` when a canonical row exists; the legacy-table id otherwise (see `hasCanonicalRecord`). */
  canonicalLeagueId: string
  /** True when `canonicalLeagueId` is a real `League.id` reachable by every downstream OS module. */
  hasCanonicalRecord: boolean
  provider: LeagueHubProvider
  sport: string
  season: number | string | null
  leagueName: string
  userTeam: LeagueHubUserTeam
  commissionerStatus: LeagueHubCommissionerStatus
  /** Resolved client-side to a static asset by provider — this service only reports the provider string. */
  platformLogoKey: LeagueHubProvider
  syncFreshness: SyncFreshness
  importType: LeagueImportType
  capabilities: ProviderCapabilityBadge[]
  /** Real `SeasonForecastSnapshot` value for the viewer's team when a snapshot exists; null otherwise — never simulated on read. */
  playoffProbability: number | null
  recommendations: LeagueRecommendationBundle
  /** Real `lastSyncedAt` (imported) or `createdAt`/team-update timestamp (native) — never invented. */
  lastActivityAt: string | null
}

export interface LeaguePortfolio {
  leagues: LeagueHubEntry[]
  sleeperUserId: string | null
}

// ── Active League Context (Parts 2, 5, 8) ─────────────────────────────────────

export interface ActiveLeagueContext {
  canonicalLeagueId: string
  provider: LeagueHubProvider
  sport: string
  season: number | string | null
  /** `LeagueTeam.id` for the viewer, or null when the viewer has no claimed team. */
  teamId: string | null
  /** `Roster.id` for the viewer when a canonical roster row exists (Trade/Waiver/Lineup OS use this). */
  rosterId: string | null
  isCommissioner: boolean
  commissionerVerificationMethod: CommissionerVerificationMethod
  syncFreshness: SyncFreshness
  /** Real `League.scoring` string (e.g. "PPR", "Half-PPR") — never invented. */
  scoring: string | null
}

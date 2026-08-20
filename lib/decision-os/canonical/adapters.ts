/**
 * Pure adapters: existing normalized AllFantasy decision/signal shapes → the canonical decision envelope
 * (Phase 3A). PURE — no provider calls, no DB, no token/freshness/snapshot mutation, no imported-platform write,
 * no route/dashboard change. Inputs are lean structural interfaces that MIRROR the audited producer types (cited
 * per adapter); Phase 3A does not couple to the heavy producers (avoids activation hazards). They are exercised
 * with fixtures/builders in tests.
 *
 * Adapters are sport-agnostic: the SAME function produces valid NFL and NCAAF decisions (sport comes from ctx).
 * They represent missing information HONESTLY — no fabricated confidence, evidence, platform, or timestamps.
 */
import {
  type CanonicalDecision,
  type CanonicalDecisionInput,
  type DecisionAudience,
  type DecisionEntitlementTier,
  type DecisionEvidenceRef,
  type DecisionFreshnessState,
  type DecisionPlayerRef,
  type DecisionSeverity,
  type DecisionSourceRef,
  type DecisionSport,
  type DecisionTokenCostClass,
  type DecisionUrgency,
} from './contract'
import type { CommissionerCategory, ManagerCategory } from './taxonomy'
import { buildCanonicalDecision } from './identity'
import { computePriorityScore } from './priority'

/** Shared per-request context every adapter needs. Supplied by the caller from the authenticated request +
 *  imported-league snapshot; never invented by the adapter. */
export type AdapterContext = {
  userId: string | null
  leagueId: string | null
  sport: DecisionSport
  season: number | null
  /** e.g. 'week:5'. */
  period: string | null
  sourcePlatform: CanonicalDecision['sourcePlatform']
  source?: DecisionSourceRef | null
  /** Defaults classified conservatively; a real gate never runs in Phase 3A. */
  entitlementTier?: DecisionEntitlementTier
  tokenCostClass?: DecisionTokenCostClass
  freshness?: DecisionFreshnessState
  dataAsOf?: string | null
  generatedAt: string
  staleAt?: string | null
  connectedFranchiseId?: string | null
  runId?: string | null
  producerVersion?: string
}

const DEFAULT_PRODUCER_VERSION = '1'

/** Pick the most specific scope whose REQUIRED identity field is actually present, so the produced decision
 *  always passes validation (never claims 'team' without a teamRef, etc.). player → team → league → user. */
function pickScope(a: { players?: DecisionPlayerRef[]; teamRef?: string | null; leagueId: string | null; userId: string | null }): CanonicalDecision['scope'] {
  if (a.players && a.players.length) return 'player'
  if (a.teamRef) return 'team'
  if (a.leagueId) return 'league'
  return 'user'
}

/** Finalize a partial into a canonical decision: compute priority, supply producer identity, build id. Adapters
 *  pass `producer` as the first arg and an optional `producerVersion`; both are omitted from the partial. */
function finalize(
  producer: string,
  partial: Omit<CanonicalDecisionInput, 'priorityScore' | 'producer' | 'producerVersion'> & {
    priorityScore?: number | null
    producerVersion?: string | undefined
  },
): CanonicalDecision {
  const priorityScore =
    partial.priorityScore ?? computePriorityScore({ severity: partial.severity, urgency: partial.urgency, confidencePct: partial.confidencePct })
  return buildCanonicalDecision({ ...partial, priorityScore, producer, producerVersion: partial.producerVersion ?? DEFAULT_PRODUCER_VERSION })
}

// ── Commissioner ─────────────────────────────────────────────────────────────────────────────────────────────
/** Mirrors `DecisionOsAttentionSignal` (lib/decision-os/attentionSignals.ts). League-scoped governance signal. */
export type CommissionerSignalInput = {
  id: string
  type: CommissionerCategory
  severity: DecisionSeverity
  title: string
  explanation: string
  recommendedAction?: string | null
  evidence?: DecisionEvidenceRef[]
  confidencePct?: number | null
  urgency?: DecisionUrgency
  /** Stable id of the subject this signal is about (e.g. the roster/manager). REQUIRED when a league can have
   *  multiple signals of the same `type` (two inactive managers, two incomplete rosters) — else they collapse to
   *  one decision. Must be stable across runs (never a per-run id). */
  subjectKey?: string | null
}

export function adaptCommissionerSignal(input: CommissionerSignalInput, ctx: AdapterContext): CanonicalDecision {
  return finalize('canonical-adapter:commissioner', {
    userId: ctx.userId,
    leagueId: ctx.leagueId,
    connectedFranchiseId: ctx.connectedFranchiseId ?? null,
    sourcePlatform: ctx.sourcePlatform,
    sport: ctx.sport,
    season: ctx.season,
    period: ctx.period,
    category: input.type,
    subtype: null,
    subjectKey: input.subjectKey ?? null,
    scope: 'commissioner',
    audience: 'commissioner',
    headline: input.title,
    explanation: input.explanation,
    recommendedAction: input.recommendedAction ?? null,
    evidence: input.evidence ?? [],
    confidencePct: input.confidencePct ?? null,
    severity: input.severity,
    urgency: input.urgency ?? (input.type === 'waiver_run_today' ? 'today' : 'this_week'),
    expectedImpact: null,
    players: [],
    teamRef: null,
    source: ctx.source ?? null,
    dataAsOf: ctx.dataAsOf ?? null,
    generatedAt: ctx.generatedAt,
    staleAt: ctx.staleAt ?? null,
    freshness: ctx.freshness ?? 'unknown',
    entitlementTier: ctx.entitlementTier ?? 'commissioner',
    tokenCostClass: ctx.tokenCostClass ?? 'included',
    suppressionReason: null,
    conflictGroupKey: null,
    supersedes: null,
    runId: ctx.runId ?? null,
    extensions: { sourceSignalId: input.id },
    producerVersion: ctx.producerVersion,
  })
}

// ── Manager ──────────────────────────────────────────────────────────────────────────────────────────────────
/** Mirrors a `Recommendation` (lib/decision-os/phase6/recommendations/types.ts). Manager (user+league) scoped. */
export type ManagerRecommendationInput = {
  id: string
  category: ManagerCategory
  title: string
  explanation: string
  recommendedAction?: string | null
  severity?: DecisionSeverity
  urgency?: DecisionUrgency
  confidencePct?: number | null
  expectedImpact?: string | null
  players?: DecisionPlayerRef[]
  teamRef?: string | null
  evidence?: DecisionEvidenceRef[]
  audience?: DecisionAudience
  /** Stable subject id when category+players+teamRef don't uniquely identify the recommendation. */
  subjectKey?: string | null
}

export function adaptManagerRecommendation(input: ManagerRecommendationInput, ctx: AdapterContext): CanonicalDecision {
  const scope = pickScope({ players: input.players, teamRef: input.teamRef, leagueId: ctx.leagueId, userId: ctx.userId })
  return finalize('canonical-adapter:manager', {
    userId: ctx.userId,
    leagueId: ctx.leagueId,
    connectedFranchiseId: ctx.connectedFranchiseId ?? null,
    sourcePlatform: ctx.sourcePlatform,
    sport: ctx.sport,
    season: ctx.season,
    period: ctx.period,
    category: input.category,
    subtype: null,
    subjectKey: input.subjectKey ?? null,
    scope,
    audience: input.audience ?? 'manager',
    headline: input.title,
    explanation: input.explanation,
    recommendedAction: input.recommendedAction ?? null,
    evidence: input.evidence ?? [],
    confidencePct: input.confidencePct ?? null,
    severity: input.severity ?? 'medium',
    urgency: input.urgency ?? 'this_week',
    expectedImpact: input.expectedImpact ?? null,
    players: input.players ?? [],
    teamRef: input.teamRef ?? null,
    source: ctx.source ?? null,
    dataAsOf: ctx.dataAsOf ?? null,
    generatedAt: ctx.generatedAt,
    staleAt: ctx.staleAt ?? null,
    freshness: ctx.freshness ?? 'unknown',
    entitlementTier: ctx.entitlementTier ?? 'subscription',
    tokenCostClass: ctx.tokenCostClass ?? 'included',
    suppressionReason: null,
    conflictGroupKey: null,
    supersedes: null,
    runId: ctx.runId ?? null,
    extensions: { sourceRecommendationId: input.id },
    producerVersion: ctx.producerVersion,
  })
}

// ── Lineup / start-sit ───────────────────────────────────────────────────────────────────────────────────────
/** Mirrors a lineup/start-sit decision (lib/decision-os/lineup, lib/ai-tools-start-sit). Team/player scoped. */
export type LineupStartSitInput = {
  id: string
  /** 'start_sit' (a specific start/sit call) or 'manager_lineup_missing' (an unset lineup). */
  category: 'start_sit' | 'manager_lineup_missing'
  title: string
  explanation: string
  recommendedAction?: string | null
  players?: DecisionPlayerRef[]
  teamRef?: string | null
  confidencePct?: number | null
  severity?: DecisionSeverity
  evidence?: DecisionEvidenceRef[]
  /** Stable subject id (e.g. the roster slot) when needed to distinguish same-category lineup calls. */
  subjectKey?: string | null
}

export function adaptLineupStartSit(input: LineupStartSitInput, ctx: AdapterContext): CanonicalDecision {
  const missing = input.category === 'manager_lineup_missing'
  return finalize('canonical-adapter:lineup', {
    userId: ctx.userId,
    leagueId: ctx.leagueId,
    connectedFranchiseId: ctx.connectedFranchiseId ?? null,
    sourcePlatform: ctx.sourcePlatform,
    sport: ctx.sport,
    season: ctx.season,
    period: ctx.period,
    category: input.category,
    subtype: null,
    subjectKey: input.subjectKey ?? null,
    scope: pickScope({ players: input.players, teamRef: input.teamRef, leagueId: ctx.leagueId, userId: ctx.userId }),
    audience: 'manager',
    headline: input.title,
    explanation: input.explanation,
    recommendedAction: input.recommendedAction ?? null,
    evidence: input.evidence ?? [],
    confidencePct: input.confidencePct ?? null,
    severity: input.severity ?? (missing ? 'high' : 'medium'),
    urgency: missing ? 'today' : 'this_week',
    expectedImpact: null,
    players: input.players ?? [],
    teamRef: input.teamRef ?? null,
    source: ctx.source ?? null,
    dataAsOf: ctx.dataAsOf ?? null,
    generatedAt: ctx.generatedAt,
    staleAt: ctx.staleAt ?? null,
    freshness: ctx.freshness ?? 'unknown',
    entitlementTier: ctx.entitlementTier ?? 'subscription',
    tokenCostClass: ctx.tokenCostClass ?? 'included',
    suppressionReason: null,
    conflictGroupKey: null,
    supersedes: null,
    runId: ctx.runId ?? null,
    extensions: { sourceId: input.id },
    producerVersion: ctx.producerVersion,
  })
}

// ── Waiver ───────────────────────────────────────────────────────────────────────────────────────────────────
/** Mirrors a `WaiverRecommendation` (lib/ai/waivers). Player-scoped; carries a conflict-group key so a future
 *  portfolio layer can detect the same target claimed across leagues (NOT computed in Phase 3A). */
export type WaiverTargetInput = {
  id: string
  title: string
  explanation: string
  recommendedAction?: string | null
  player: DecisionPlayerRef
  teamRef?: string | null
  confidencePct?: number | null
  severity?: DecisionSeverity
  evidence?: DecisionEvidenceRef[]
  /** Optional explicit subject id; when absent the player identity already discriminates waiver targets. */
  subjectKey?: string | null
}

export function adaptWaiverTarget(input: WaiverTargetInput, ctx: AdapterContext): CanonicalDecision {
  const playerKey = input.player.canonicalPlayerId ?? (input.player.name ?? '').trim().toLowerCase()
  return finalize('canonical-adapter:waiver', {
    userId: ctx.userId,
    leagueId: ctx.leagueId,
    connectedFranchiseId: ctx.connectedFranchiseId ?? null,
    sourcePlatform: ctx.sourcePlatform,
    sport: ctx.sport,
    season: ctx.season,
    period: ctx.period,
    category: 'waiver_target',
    subtype: null,
    subjectKey: input.subjectKey ?? null,
    scope: 'player',
    audience: 'manager',
    headline: input.title,
    explanation: input.explanation,
    recommendedAction: input.recommendedAction ?? null,
    evidence: input.evidence ?? [],
    confidencePct: input.confidencePct ?? null,
    severity: input.severity ?? 'medium',
    urgency: 'this_week',
    expectedImpact: null,
    players: [input.player],
    teamRef: input.teamRef ?? null,
    source: ctx.source ?? null,
    dataAsOf: ctx.dataAsOf ?? null,
    generatedAt: ctx.generatedAt,
    staleAt: ctx.staleAt ?? null,
    freshness: ctx.freshness ?? 'unknown',
    entitlementTier: ctx.entitlementTier ?? 'subscription',
    tokenCostClass: ctx.tokenCostClass ?? 'included',
    suppressionReason: null,
    // Portfolio FORWARD-COMPAT: a stable key for the same player target (used by a future cross-league resolver).
    conflictGroupKey: playerKey ? `waiver:${ctx.sport}:${ctx.season ?? ''}:${playerKey}` : null,
    supersedes: null,
    runId: ctx.runId ?? null,
    extensions: { sourceId: input.id },
    producerVersion: ctx.producerVersion,
  })
}

// ── Trade ────────────────────────────────────────────────────────────────────────────────────────────────────
/** Mirrors a trade review/target decision (lib/ai/opponents, trade intelligence). */
export type TradeReviewInput = {
  id: string
  /** 'trade_review' (evaluate a pending/offered trade) or 'trade_target' (a proactive trade idea). */
  category: 'trade_review' | 'trade_target'
  title: string
  explanation: string
  recommendedAction?: string | null
  players?: DecisionPlayerRef[]
  teamRef?: string | null
  confidencePct?: number | null
  severity?: DecisionSeverity
  expectedImpact?: string | null
  evidence?: DecisionEvidenceRef[]
  /** Stable id of the SPECIFIC trade proposal (e.g. the platform transaction id). REQUIRED to keep two distinct
   *  proposals apart when they involve the same players (counteroffers / variants) — else they collapse. */
  subjectKey?: string | null
}

export function adaptTradeReview(input: TradeReviewInput, ctx: AdapterContext): CanonicalDecision {
  return finalize('canonical-adapter:trade', {
    userId: ctx.userId,
    leagueId: ctx.leagueId,
    connectedFranchiseId: ctx.connectedFranchiseId ?? null,
    sourcePlatform: ctx.sourcePlatform,
    sport: ctx.sport,
    season: ctx.season,
    period: ctx.period,
    category: input.category,
    subtype: null,
    subjectKey: input.subjectKey ?? null,
    scope: pickScope({ players: input.players, teamRef: input.teamRef, leagueId: ctx.leagueId, userId: ctx.userId }),
    audience: 'manager',
    headline: input.title,
    explanation: input.explanation,
    recommendedAction: input.recommendedAction ?? null,
    evidence: input.evidence ?? [],
    confidencePct: input.confidencePct ?? null,
    severity: input.severity ?? 'medium',
    urgency: input.category === 'trade_review' ? 'today' : 'this_week',
    expectedImpact: input.expectedImpact ?? null,
    players: input.players ?? [],
    teamRef: input.teamRef ?? null,
    source: ctx.source ?? null,
    dataAsOf: ctx.dataAsOf ?? null,
    generatedAt: ctx.generatedAt,
    staleAt: ctx.staleAt ?? null,
    freshness: ctx.freshness ?? 'unknown',
    entitlementTier: ctx.entitlementTier ?? 'subscription',
    tokenCostClass: ctx.tokenCostClass ?? 'included',
    suppressionReason: null,
    conflictGroupKey: null,
    supersedes: null,
    runId: ctx.runId ?? null,
    extensions: { sourceId: input.id },
    producerVersion: ctx.producerVersion,
  })
}

/**
 * Shared Waiver Service — shadow-compare seam (Phase 12).
 *
 * Runs BESIDE the legacy /api/waiver-ai/engine response, comparing the
 * legacy runWaiverAIService() output (fed the client-supplied roster/pool
 * context) against lib/shared-services/waiver's evaluateWaiverShadow()
 * (fed its OWN, independently DB-assembled roster/pool context via
 * WaiverContextAssembler.ts). This is a genuinely different comparison from
 * the existing lib/decision-os/waiver/shadow.ts, which wraps the SAME
 * client-supplied engineInput (wrap-fidelity, zero recompute) — this seam
 * exists specifically to validate whether the shared service's independent,
 * provider-neutral context assembly produces an equivalent view of a real
 * roster/league to whatever the live route's caller currently supplies.
 *
 * NEVER affects the legacy response. NEVER throws past this module's own
 * boundary. Gated by SHARED_SERVICES_WAIVER_SHADOW_COMPARE, read via the
 * same shouldRunShadow()/DecisionShadowScope convention every other
 * Decision OS slice already uses (lib/decision-os/core/shadow) — not a new
 * flag framework. Rosters are resolved via loadWaiverWorldFacts() — the
 * SAME real, already-tested userId+leagueId → rosterId resolution
 * lib/decision-os/waiver/shadow.ts's own runWaiverShadowForEngine() uses —
 * never from client-supplied identifiers, so a request can never point the
 * shared service at a roster/league it isn't authorized to see.
 */

import { shouldRunShadow, type DecisionShadowScope } from '@/lib/decision-os/core/shadow'
import { emitShadowParity } from '@/lib/decision-os/core/parity'
import { loadWaiverWorldFacts } from './loader'
import { extractWaiverRequestContext, type WaiverRequestContext } from './WaiverRequestContext'
import { evaluateWaiverShadow } from '@/lib/shared-services/waiver/WaiverShadowService'
import type { WaiverAIServiceInput, WaiverAIServiceOutput } from '@/lib/waiver-ai-engine'
import type { ScoredWaiverTarget } from '@/lib/waiver-engine/waiver-scoring'

const SHARED_WAIVER_SHADOW_COMPARE_FLAG = 'SHARED_SERVICES_WAIVER_SHADOW_COMPARE'
const SHADOW_COMPARE_TIMEOUT_MS = 4000

export function shouldRunSharedWaiverShadowCompare(
  env: NodeJS.ProcessEnv = process.env,
  scope?: DecisionShadowScope,
): boolean {
  return shouldRunShadow(SHARED_WAIVER_SHADOW_COMPARE_FLAG, env, scope)
}

export type WaiverShadowCompareStatus =
  | 'exact_match'
  | 'equivalent'
  | 'acceptable_variance'
  | 'material_divergence'
  | 'unsupported_comparison'
  | 'insufficient_context'
  | 'shadow_execution_failure'

export interface WaiverShadowCompareResult {
  ran: boolean
  status: WaiverShadowCompareStatus
  leagueId: string
  rosterId: string | null
  provider: string | null
  requestedSport: string | null
  resolvedSport: string | null
  topCandidateAgreement: boolean | null
  legacyTopCandidateId: string | null
  sharedTopCandidateId: string | null
  /** Whether the shared service's top pick appears anywhere in the legacy engine's own ranked list — a real, computable overlap proxy since WaiverEvaluation only exposes its own top candidate, not a full ranked list (see module docstring's scope note). */
  candidateOverlap: boolean | null
  scoreDelta: number | null
  faabDelta: number | null
  authoritativeDurationMs: number
  sharedServiceDurationMs: number | null
  totalDurationMs: number
  failureReason: string | null
  unsupportedReason: string | null
  /** Phase 15 — the exact request-scoped fields both engines were evaluated with (extracted from the authoritative request, always available regardless of whether the shared evaluation itself succeeds). Proves the comparison used an identical decision context, not just identical identity. */
  requestContext: WaiverRequestContext
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

function findRankInLegacy(playerId: string | null, legacySuggestions: ScoredWaiverTarget[]): number | null {
  if (!playerId) return null
  const index = legacySuggestions.findIndex((s) => s.playerId === playerId)
  return index === -1 ? null : index
}

function classifyStatus(input: {
  legacyTop: ScoredWaiverTarget | null
  legacySuggestions: ScoredWaiverTarget[]
  sharedTopId: string | null
}): { status: WaiverShadowCompareStatus; topCandidateAgreement: boolean | null; candidateOverlap: boolean | null } {
  const { legacyTop, legacySuggestions, sharedTopId } = input

  if (!legacyTop && !sharedTopId) {
    return { status: 'exact_match', topCandidateAgreement: true, candidateOverlap: true }
  }
  if (!legacyTop || !sharedTopId) {
    // One-sided empty result — a real, meaningful divergence, not silently treated as agreement.
    return { status: 'material_divergence', topCandidateAgreement: false, candidateOverlap: false }
  }

  const topCandidateAgreement = legacyTop.playerId === sharedTopId
  if (topCandidateAgreement) {
    return { status: 'equivalent', topCandidateAgreement: true, candidateOverlap: true }
  }

  const rankInLegacy = findRankInLegacy(sharedTopId, legacySuggestions)
  const candidateOverlap = rankInLegacy !== null
  return {
    status: candidateOverlap ? 'acceptable_variance' : 'material_divergence',
    topCandidateAgreement: false,
    candidateOverlap,
  }
}

export interface RunSharedWaiverShadowCompareArgs {
  userId: string
  leagueId: string
  engineInput: WaiverAIServiceInput
  legacyAnalysis: WaiverAIServiceOutput
  authoritativeDurationMs: number
}

/**
 * Runs the shared Waiver Service in shadow mode and compares it against the
 * legacy engine's already-computed output. Never throws. Never awaited by
 * the route in a way that can affect the response beyond the bounded
 * timeout below — the caller (route.ts) is expected to fire this without
 * blocking the response write.
 */
export async function runSharedWaiverShadowCompare(args: RunSharedWaiverShadowCompareArgs): Promise<WaiverShadowCompareResult> {
  const totalStart = Date.now()
  // Phase 15: the exact request-scoped fields (currentWeek/goal/maxResults)
  // the authoritative engine evaluated with — extracted once, forwarded into
  // the shared evaluation below, so both sides answer the same question.
  const requestContext = extractWaiverRequestContext(args.engineInput)
  const base = {
    ran: false as const,
    leagueId: args.leagueId,
    rosterId: null,
    provider: null,
    requestedSport: args.engineInput.sport ?? null,
    resolvedSport: null,
    topCandidateAgreement: null,
    legacyTopCandidateId: null,
    sharedTopCandidateId: null,
    candidateOverlap: null,
    scoreDelta: null,
    faabDelta: null,
    authoritativeDurationMs: args.authoritativeDurationMs,
    sharedServiceDurationMs: null,
    failureReason: null,
    unsupportedReason: null,
    requestContext,
  }

  let facts: Awaited<ReturnType<typeof loadWaiverWorldFacts>>
  try {
    facts = await loadWaiverWorldFacts(args.userId, args.leagueId)
  } catch (err) {
    const result: WaiverShadowCompareResult = {
      ...base,
      status: 'shadow_execution_failure',
      totalDurationMs: Date.now() - totalStart,
      failureReason: err instanceof Error ? err.message : 'world_facts_error',
    }
    emitShadowParity('shared_services.waiver', { compare: true, ran: false, reason: 'world_facts_error', leagueId: args.leagueId, comparisonVersion: 'phase15-decision-context' })
    return result
  }

  if (!facts) {
    const result: WaiverShadowCompareResult = {
      ...base,
      status: 'insufficient_context',
      totalDurationMs: Date.now() - totalStart,
      unsupportedReason: 'No roster could be resolved for this authorized user in this league.',
    }
    emitShadowParity('shared_services.waiver', { compare: true, ran: false, reason: 'insufficient_context', leagueId: args.leagueId, comparisonVersion: 'phase15-decision-context' })
    return result
  }

  const legacySuggestions = args.legacyAnalysis.deterministic?.suggestions ?? []
  const legacyTop = legacySuggestions[0] ?? null

  const sharedStart = Date.now()
  try {
    const evaluation = await withTimeout(
      evaluateWaiverShadow({
        leagueId: args.leagueId,
        rosterId: facts.rosterId,
        currentWeek: requestContext.currentWeek,
        goal: requestContext.goal,
        maxResults: requestContext.maxResults,
      }),
      SHADOW_COMPARE_TIMEOUT_MS,
      'shared waiver shadow evaluation',
    )
    const sharedServiceDurationMs = Date.now() - sharedStart
    const sharedTopId = evaluation.topCandidate?.playerId ?? null

    const { status, topCandidateAgreement, candidateOverlap } = classifyStatus({ legacyTop, legacySuggestions, sharedTopId })

    const scoreDelta = legacyTop && evaluation.recommendation.score != null ? legacyTop.compositeScore - evaluation.recommendation.score : null
    const faabDelta =
      legacyTop?.faabBid != null && evaluation.faab.recommendedBid != null ? legacyTop.faabBid - evaluation.faab.recommendedBid : null

    const sportMismatch = Boolean(base.requestedSport && facts.sport && base.requestedSport.toUpperCase() !== facts.sport.toUpperCase())

    const result: WaiverShadowCompareResult = {
      ...base,
      ran: true,
      status,
      rosterId: facts.rosterId,
      provider: evaluation.platform,
      resolvedSport: facts.sport,
      topCandidateAgreement,
      legacyTopCandidateId: legacyTop?.playerId ?? null,
      sharedTopCandidateId: sharedTopId,
      candidateOverlap,
      scoreDelta,
      faabDelta,
      sharedServiceDurationMs,
      totalDurationMs: Date.now() - totalStart,
      unsupportedReason: sportMismatch
        ? `Requested sport "${base.requestedSport}" does not match the shared service's DB-resolved sport "${facts.sport}" — comparison may reflect a stale client-supplied sport, not a real divergence.`
        : legacySuggestions.length === 0 && sharedTopId
          ? 'Legacy engine returned no suggestions to compare a full ranked position against.'
          : null,
    }

    emitShadowParity('shared_services.waiver', {
      compare: true,
      ran: true,
      status,
      leagueId: args.leagueId,
      provider: evaluation.platform,
      topCandidateAgreement,
      candidateOverlap,
      scoreDelta,
      faabDelta,
      authoritativeDurationMs: args.authoritativeDurationMs,
      sharedServiceDurationMs,
      totalDurationMs: Date.now() - totalStart,
      confidence: evaluation.confidence,
      freshness: evaluation.freshness.contextAssembledAt,
      // Phase 15 — proves both engines evaluated the same decision context, not just the same identity.
      comparisonVersion: 'phase15-decision-context',
      currentWeek: requestContext.currentWeek,
      goal: requestContext.goal,
      maxResults: requestContext.maxResults,
    })

    return result
  } catch (err) {
    const isTimeout = err instanceof Error && err.message.includes('timed out')
    const result: WaiverShadowCompareResult = {
      ...base,
      ran: true,
      status: 'shadow_execution_failure',
      rosterId: facts.rosterId,
      resolvedSport: facts.sport,
      sharedServiceDurationMs: Date.now() - sharedStart,
      totalDurationMs: Date.now() - totalStart,
      failureReason: err instanceof Error ? err.message : 'shared_service_error',
    }
    emitShadowParity('shared_services.waiver', {
      compare: true,
      ran: true,
      status: 'shadow_execution_failure',
      reason: isTimeout ? 'timeout' : 'exception',
      leagueId: args.leagueId,
      totalDurationMs: Date.now() - totalStart,
      comparisonVersion: 'phase15-decision-context',
      currentWeek: requestContext.currentWeek,
      goal: requestContext.goal,
      maxResults: requestContext.maxResults,
    })
    return result
  }
}

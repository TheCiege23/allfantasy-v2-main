/**
 * Decision OS — shared-services waiver shadow compare (Phase 12 / Phase 15).
 *
 * Restored from its own test suite (`__tests__/decision-os/waiver-shared-service-
 * shadow-compare.test.ts`), which shipped in the Phase 17 rescue commit without this
 * source file. The tests are the spec; this implements them exactly.
 *
 * Runs the shared-services waiver evaluation (`evaluateWaiverShadow`) BESIDE the
 * authoritative engine's already-computed analysis and classifies agreement:
 *
 *   exact_match          — both engines agree there is no candidate
 *   equivalent           — same top candidate
 *   acceptable_variance  — shared top candidate appears lower in the legacy list
 *   material_divergence  — one-sided empty, or shared top absent from legacy list
 *   insufficient_context — no roster resolvable for this authorized user
 *   shadow_execution_failure — the shared service threw / timed out (never
 *                              presented as a fabricated empty-result match)
 *
 * Identity (leagueId/rosterId) is server-resolved via `loadWaiverWorldFacts`,
 * never client-supplied; the request-scoped decision context (currentWeek / goal /
 * maxResults) crosses the boundary via `extractWaiverRequestContext` so both
 * engines evaluate the SAME decision (Phase 15). Never throws; comparison-only —
 * nothing live consumes the result.
 */
import { loadWaiverWorldFacts } from '@/lib/decision-os/waiver/loader'
import { evaluateWaiverShadow } from '@/lib/shared-services/waiver/WaiverShadowService'
import { emitShadowParity } from '@/lib/decision-os/core/parity'
import { extractWaiverRequestContext, type WaiverRequestContext } from './WaiverRequestContext'
import type { WaiverAIServiceInput, WaiverAIServiceOutput } from '@/lib/waiver-ai-engine'

export const SHARED_WAIVER_COMPARE_FLAG = 'SHARED_SERVICES_WAIVER_SHADOW_COMPARE'
const COMPARISON_VERSION = 'phase15-decision-context'
const SHADOW_TIMEOUT_MS = 5_000

export type SharedWaiverCompareStatus =
  | 'exact_match'
  | 'equivalent'
  | 'acceptable_variance'
  | 'material_divergence'
  | 'insufficient_context'
  | 'shadow_execution_failure'

export interface SharedWaiverCompareResult {
  status: SharedWaiverCompareStatus
  ran: boolean
  topCandidateAgreement: boolean | null
  candidateOverlap: boolean | null
  scoreDelta: number | null
  faabDelta: number | null
  /** The exact request-scoped context both engines were evaluated with. */
  requestContext: WaiverRequestContext
  /** The shared evaluation's own platform tag (provenance only — no branching on it). */
  provider: string | null
  authoritativeDurationMs: number
  sharedServiceDurationMs: number | null
  totalDurationMs: number | null
  unsupportedReason: string | null
  failureReason: string | null
}

/** Disabled unless the flag is the literal string "true" (case-insensitive). */
export function shouldRunSharedWaiverShadowCompare(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return String(env[SHARED_WAIVER_COMPARE_FLAG] ?? '').trim().toLowerCase() === 'true'
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`shared waiver shadow timed out after ${ms}ms`)), ms),
    ),
  ])
}

export async function runSharedWaiverShadowCompare(args: {
  userId: string
  leagueId: string
  engineInput: WaiverAIServiceInput
  legacyAnalysis: WaiverAIServiceOutput
  authoritativeDurationMs: number
}): Promise<SharedWaiverCompareResult> {
  const requestContext = extractWaiverRequestContext(args.engineInput)

  const base: SharedWaiverCompareResult = {
    status: 'shadow_execution_failure',
    ran: false,
    topCandidateAgreement: null,
    candidateOverlap: null,
    scoreDelta: null,
    faabDelta: null,
    requestContext,
    provider: null,
    authoritativeDurationMs: args.authoritativeDurationMs,
    sharedServiceDurationMs: null,
    totalDurationMs: null,
    unsupportedReason: null,
    failureReason: null,
  }

  const emit = (result: SharedWaiverCompareResult) => {
    // Telemetry convention: no secrets/tokens/raw payloads — counted flags + the
    // exact decision context both engines were evaluated with (Phase 15).
    emitShadowParity('shared_services.waiver', {
      compare: true,
      ran: result.ran,
      leagueId: args.leagueId,
      status: result.status,
      comparisonVersion: COMPARISON_VERSION,
      currentWeek: requestContext.currentWeek,
      goal: requestContext.goal,
      maxResults: requestContext.maxResults,
      ...(result.topCandidateAgreement != null ? { topCandidateAgreement: result.topCandidateAgreement } : {}),
      ...(result.failureReason ? { failureReason: result.failureReason } : {}),
      ...(result.unsupportedReason ? { unsupportedReason: result.unsupportedReason } : {}),
    })
    return result
  }

  let facts: Awaited<ReturnType<typeof loadWaiverWorldFacts>>
  try {
    facts = await loadWaiverWorldFacts(args.userId, args.leagueId)
  } catch (error) {
    return emit({
      ...base,
      status: 'shadow_execution_failure',
      failureReason: error instanceof Error ? error.message : 'unknown_error',
    })
  }
  if (!facts) {
    return emit({ ...base, status: 'insufficient_context' })
  }

  // Honest sport-mismatch disclosure — a cross-sport comparison is not a real
  // recommendation divergence, so it is flagged rather than misclassified.
  const requestSport = String(args.engineInput.sport ?? '').toUpperCase()
  const unsupportedReason =
    requestSport && String(facts.sport ?? '').toUpperCase() !== requestSport
      ? `world sport ${facts.sport} does not match request sport ${args.engineInput.sport}`
      : null

  const sharedStartedAt = Date.now()
  let evaluation: Awaited<ReturnType<typeof evaluateWaiverShadow>>
  try {
    evaluation = await withTimeout(
      evaluateWaiverShadow({
        leagueId: args.leagueId,
        rosterId: facts.rosterId,
        currentWeek: requestContext.currentWeek,
        goal: requestContext.goal,
        maxResults: requestContext.maxResults,
      } as Parameters<typeof evaluateWaiverShadow>[0]),
      SHADOW_TIMEOUT_MS,
    )
  } catch (error) {
    return emit({
      ...base,
      unsupportedReason,
      status: 'shadow_execution_failure',
      failureReason: error instanceof Error ? error.message : 'unknown_error',
    })
  }
  const sharedServiceDurationMs = Date.now() - sharedStartedAt

  const legacySuggestions = args.legacyAnalysis?.deterministic?.suggestions ?? []
  const legacyTop = legacySuggestions[0] ?? null
  const sharedTop = evaluation?.topCandidate ?? null

  let status: SharedWaiverCompareStatus
  let topCandidateAgreement: boolean
  let candidateOverlap: boolean | null = null
  let scoreDelta: number | null = null
  let faabDelta: number | null = null

  if (!legacyTop && !sharedTop) {
    status = 'exact_match'
    topCandidateAgreement = true
  } else if (!legacyTop || !sharedTop) {
    status = 'material_divergence'
    topCandidateAgreement = false
  } else {
    const sharedScore = evaluation?.recommendation?.score
    const sharedBid = evaluation?.faab?.recommendedBid
    scoreDelta =
      typeof legacyTop.compositeScore === 'number' && typeof sharedScore === 'number'
        ? Math.abs(legacyTop.compositeScore - sharedScore)
        : null
    faabDelta =
      typeof legacyTop.faabBid === 'number' && typeof sharedBid === 'number'
        ? Math.abs(legacyTop.faabBid - sharedBid)
        : null

    if (legacyTop.playerId === sharedTop.playerId) {
      status = 'equivalent'
      topCandidateAgreement = true
      candidateOverlap = true
    } else if (legacySuggestions.some((s) => s.playerId === sharedTop.playerId)) {
      status = 'acceptable_variance'
      topCandidateAgreement = false
      candidateOverlap = true
    } else {
      status = 'material_divergence'
      topCandidateAgreement = false
      candidateOverlap = false
    }
  }

  return emit({
    ...base,
    status,
    ran: true,
    topCandidateAgreement,
    candidateOverlap,
    scoreDelta,
    faabDelta,
    provider: typeof evaluation?.platform === 'string' ? evaluation.platform : null,
    sharedServiceDurationMs,
    totalDurationMs: args.authoritativeDurationMs + sharedServiceDurationMs,
    unsupportedReason,
  })
}

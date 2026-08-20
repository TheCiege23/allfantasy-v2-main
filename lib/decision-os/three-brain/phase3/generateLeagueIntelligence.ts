import 'server-only'

import { prisma as defaultPrisma } from '@/lib/prisma'
import { buildLeagueIntelligenceEvidence } from '../phase2/leagueEvidenceResolver'
import { runManagedIntelligence } from '../phase2/intelligenceService'
import { createManagedIntelligenceDeps } from '../phase2/realAdapters'
import { isAiSpendDisabledError } from '@/lib/ai/aiSpendGuard'
import type { IntelligenceTool } from '../phase2/types'
import type { ThreeBrainDecisionResult } from '../types'

type PrismaLike = typeof defaultPrisma

/**
 * Phase 3 — the WRITE half. The counterpart to `readLeagueIntelligence`, and the only path that can
 * bring an analysis into existence.
 *
 * Kept separate from the read module on purpose. The read is free, side-effect-free and safe to call
 * on every page render; this one can call three providers and spend a user's tokens. Two files means
 * you cannot reach for the expensive one by accident, and a reviewer can see which is which from the
 * import alone.
 *
 * Everything costly stays inside `runManagedIntelligence`: entitlement and league-access checks before
 * any provider or token activity, DB-first reuse, single-flight coalescing so concurrent callers share
 * one run, and idempotent token reservation. This module only builds the evidence, calls it, and maps
 * the response to something safe to hand a client.
 */
export type GenerateStatus =
  /** A run completed and its result is attached. */
  | 'ready'
  /** Another caller already owns the run; this request coalesced onto it. No duplicate provider spend. */
  | 'generating'
  /** Entitlement/token/league-access refused. `reason` says which — never a server fault. */
  | 'denied'
  /** The run failed. `reason` is a category, never a provider's raw error text. */
  | 'failed'
  /** No persisted behavioral evidence for this league, so there is nothing to analyze. */
  | 'evidence_unavailable'
  /** A scope this resolver cannot rebuild (e.g. a connected league group). */
  | 'unsupported_scope'

export type GenerateOutcome = {
  status: GenerateStatus
  result: ThreeBrainDecisionResult | null
  generatedAt: string | null
  /** Which providers participated. Safe attribution only — no raw responses or reasoning. */
  providerAttribution: Record<string, string> | null
  /** Machine-readable cause for every non-`ready` status. */
  reason: string | null
  /** True when a refresh is running behind a deliberately-served stale result. */
  refreshInProgress: boolean
}

function outcome(
  status: GenerateStatus,
  reason: string | null,
  extra: Partial<GenerateOutcome> = {},
): GenerateOutcome {
  return {
    status,
    result: null,
    generatedAt: null,
    providerAttribution: null,
    reason,
    refreshInProgress: false,
    ...extra,
  }
}

/**
 * Generate (or reuse) the analysis for one league + tool on behalf of a specific user.
 *
 * The caller MUST have already authenticated the user and checked league access — `runManagedIntelligence`
 * re-checks both, but this function trusts its `userId` argument and must never receive one from a
 * client-supplied field.
 */
export async function generateLeagueIntelligence(input: {
  db?: PrismaLike
  leagueId: string
  userId: string
  tool: IntelligenceTool
  decisionType: string
  connectedGroupId?: string | null
}): Promise<GenerateOutcome> {
  const db = input.db ?? defaultPrisma

  const evidence = await buildLeagueIntelligenceEvidence({
    db,
    leagueId: input.leagueId,
    userId: input.userId,
    tool: input.tool,
    decisionType: input.decisionType,
    connectedGroupId: input.connectedGroupId ?? null,
  })
  if (!evidence.ok) {
    const unsupported = evidence.reason === 'connected_group_refresh_unsupported'
    // Refuse BEFORE any provider or token activity: with no evidence there is nothing to analyze, and
    // running anyway would bill the user for a model improvising over an empty packet.
    return outcome(unsupported ? 'unsupported_scope' : 'evidence_unavailable', evidence.reason)
  }

  let response
  try {
    response = await runManagedIntelligence(evidence.ctx, createManagedIntelligenceDeps({ prisma: db }))
  } catch (error) {
    // The global spend switch is a payment state, not a fault. Map it to the same `denied` shape the
    // entitlement path uses so the route answers 402 and the client can offer the upgrade or token
    // route, rather than showing a user a generic server error for a deliberate business decision.
    if (isAiSpendDisabledError(error)) {
      return outcome('denied', 'ai_spend_disabled')
    }
    throw error
  }

  if (response.status === 'denied') {
    return outcome('denied', response.denyReason ?? 'denied')
  }
  if (response.status === 'running' || response.status === 'pending') {
    return outcome('generating', 'coalesced_onto_running_run', { refreshInProgress: response.refreshInProgress })
  }
  if (response.status === 'succeeded' && response.result) {
    return {
      status: 'ready',
      result: response.result,
      generatedAt: response.generatedAt,
      providerAttribution: response.providerAttribution,
      reason: null,
      refreshInProgress: response.refreshInProgress,
    }
  }
  // `failed`, `invalidated`, `unknown`, or succeeded-without-a-payload. Surface the CATEGORY only —
  // a provider's raw error can carry request context and must never reach a client.
  return outcome('failed', response.failure?.category ?? response.status)
}

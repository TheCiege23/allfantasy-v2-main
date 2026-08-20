import 'server-only'

import { prisma as defaultPrisma } from '@/lib/prisma'
import { readLeagueIntelligence } from '../phase3/readLeagueIntelligence'
import { enrichDecisionExplanation } from './explanationEnrichment'
import { resolveAiAuthority } from './aiAuthorityPolicy'
import type { Decision } from '../../core/decision'
import type { IntelligenceTool } from '../phase2/types'

type PrismaLike = typeof defaultPrisma

/**
 * The connector between a live Decision and a saved three-brain analysis.
 *
 * `enrichDecisionExplanation` enforces the invariant but had no caller — the analysis, even once
 * generated, reached nobody. This is the piece that puts it in front of a user, and it is the last
 * link in evidence → analysis → recommendation.
 *
 * DESIGNED TO COST NOTHING WHEN THERE IS NOTHING TO SHOW, which is the overwhelmingly common case
 * and the permanent case while `AI_FEATURES_ENABLED` is off. `readLeagueIntelligence` rebuilds the
 * whole evidence packet to derive its identity key — several queries — so calling it on every
 * request to discover "no analysis" would tax a live route for nothing. A single indexed count
 * short-circuits that: no succeeded run for this user and league means no possible enrichment.
 *
 * NEVER THROWS. Callers mount this on paths that document "must never fail the route" — enrichment
 * is decoration over a Decision that is already complete and correct without it.
 */
export type AttachOutcome<TAction> = {
  decision: Decision<TAction>
  /** True only when AI prose actually replaced the deterministic explanation. */
  enriched: boolean
  /** Machine-readable why, for telemetry. Never surfaced to a user. */
  reason: string | null
}

export async function attachSavedAnalysis<TAction = unknown>(input: {
  db?: PrismaLike
  decision: Decision<TAction>
  leagueId: string
  userId: string
  tool: IntelligenceTool
}): Promise<AttachOutcome<TAction>> {
  const { decision, leagueId, userId, tool } = input
  const db = input.db ?? defaultPrisma

  try {
    // Gate 0 — authority. A decision type that may not be model-authored also may not be
    // model-EXPLAINED beyond the deterministic seam; checked here so a future caller cannot reach
    // enrichment on a path the policy never sanctioned. Fail-closed by construction.
    if (resolveAiAuthority(decision.decision_type) !== 'explanation_only') {
      // `may_author` types are narrative surfaces that do not produce Decision objects at all;
      // reaching here means a caller wired something unexpected.
      return { decision, enriched: false, reason: 'unexpected_authority_for_decision' }
    }

    // Gate 1 — the cheap one. One indexed count instead of rebuilding an evidence packet.
    const runs = await db.decisionIntelligenceRun.count({
      where: { userId, leagueId, status: 'succeeded' },
    })
    if (runs === 0) return { decision, enriched: false, reason: 'no_succeeded_run' }

    // Gate 2 — the real read. Entitlement-checked; returns `locked` for a user who may not see it.
    const read = await readLeagueIntelligence({
      db,
      leagueId,
      userId,
      tool,
      decisionType: decision.decision_type,
    })

    const out = enrichDecisionExplanation({
      decision,
      result: read.result,
      status: read.status,
    })

    return out.enriched
      ? { decision: out.decision, enriched: true, reason: out.stale ? 'stale' : null }
      : { decision: out.decision, enriched: false, reason: out.reason }
  } catch {
    // The Decision is already complete without this. Returning it unchanged is the correct
    // degraded answer, and the routes that call this cannot be allowed to fail here.
    return { decision, enriched: false, reason: 'attach_failed' }
  }
}

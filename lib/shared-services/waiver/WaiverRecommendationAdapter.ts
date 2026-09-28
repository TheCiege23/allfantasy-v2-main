/**
 * Waiver Recommendation Adapter — Waiver OS foundation, Phase 7.
 *
 * Wraps the ONE real, independently-computed comparison-only waiver engine
 * found during the audit: lib/ai/waivers/waiverRecommendationService.ts's
 * generateWaiverRecommendations(). This is the "T2" role from Trade OS's
 * LegacyGraderAdapters.ts — a genuinely separate implementation (its own
 * FAAB percentage-slicing, its own prisma reads), used only for divergence
 * comparison, never as the shadow's own primary value.
 *
 * Two real engines were found NOT to play this role, and are deliberately
 * left untouched (see the README for the full audit):
 *  - lib/waiver-engine/waiver-faab-engine.ts's exported computeFaabBid/
 *    computeFaabStrategy — confirmed ORPHANED (re-exported by the barrel,
 *    zero real callers anywhere in app/ or components/ or lib/).
 *  - lib/trade-engine/waiverEngine.ts — also confirmed orphaned/dead code.
 * Neither is wired into this adapter; resurrecting or deleting either is out
 * of scope for this shadow-mode phase.
 *
 * This adapter's own call is a genuinely independent data path from the
 * WaiverContextAssembler-built context: generateWaiverRecommendations does
 * its own prisma reads keyed by userId, not the assembler's rosterId. A
 * mismatch between the assembler's managerKey and this function's expected
 * userId is possible depending on provider and is a known, documented
 * limitation — comparison-only impact, never authoritative.
 */

import { generateWaiverRecommendations } from '@/lib/ai/waivers/waiverRecommendationService'
import { FOREIGN_IDS_UNREADABLE } from '@/lib/core-app/foreignIdSpaceCopy'
import { isForeignIdSpace } from '@/lib/core-app/rosterIdSpace'
import { prisma } from '@/lib/prisma'
import type { LegacyWaiverGraderResult } from './types'

export async function runLegacyWaiverGrader(input: { leagueId: string; managerKey: string | null }): Promise<LegacyWaiverGraderResult> {
  const graderId = 'waiver_recommendation_service' as const
  const unavailable = (error: string): LegacyWaiverGraderResult => ({
    graderId,
    topAddPlayerId: null,
    topAddPlayerName: null,
    faabBid: null,
    priority: null,
    confidence: null,
    error,
  })
  if (!input.managerKey) return unavailable('No manager identifier available for this roster.')
  // The legacy engine reads a foreign league's roster ids as Sleeper ids (they collide); a pick
  // built on strangers is not a comparison worth logging. Same gate as /api/ai/waivers/recommend.
  const league = await prisma.league
    .findUnique({ where: { id: input.leagueId }, select: { platform: true } })
    .catch(() => null)
  if (isForeignIdSpace(league?.platform)) return unavailable(`${FOREIGN_IDS_UNREADABLE}.`)

  try {
    const output = await generateWaiverRecommendations({
      userId: input.managerKey,
      leagueId: input.leagueId,
      mode: 'quick',
      includeFaab: true,
    })
    const top = output.recommendations[0] ?? null
    return {
      graderId,
      topAddPlayerId: top?.addPlayerId ?? null,
      topAddPlayerName: top?.addPlayerName ?? null,
      faabBid: top?.suggestedFaabBid ?? null,
      priority: top?.priority ?? null,
      confidence: top?.confidence ?? null,
      error: null,
    }
  } catch (err) {
    return {
      graderId,
      topAddPlayerId: null,
      topAddPlayerName: null,
      faabBid: null,
      priority: null,
      confidence: null,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

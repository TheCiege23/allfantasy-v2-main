/**
 * PrestigeGovernanceOrchestrator — single entry point for the unified prestige and governance layer.
 * Coordinates commissioner context, trust, Hall of Fame, and legacy for dashboards and AI.
 */

import { buildCommissionerTrustContext } from './CommissionerTrustBridge'
import { getUnifiedManagerSummary, getUnifiedManagerSummaries } from './UnifiedPrestigeQueryService'
import { buildAIPrestigeContext } from './AIPrestigeContextResolver'
import type { CommissionerTrustContext, UnifiedManagerSummary, AIPrestigeContextPayload } from './types'

interface PrestigeGovernanceSnapshot {
  commissionerContext: CommissionerTrustContext
  /** Sample of unified manager summaries (e.g. top 20 by legacy or reputation). */
  sampleManagerSummaries: UnifiedManagerSummary[]
  aiContext: AIPrestigeContextPayload
}

/**
 * Build a full snapshot for a league: commissioner trust context, sample manager summaries, and AI context.
 * Use for commissioner dashboard, AI explanation context, or unified prestige widgets.
 */
export async function buildPrestigeGovernanceSnapshot(
  leagueId: string,
  options?: { sport?: string | null; limitSummaries?: number }
): Promise<PrestigeGovernanceSnapshot> {
  const limit = options?.limitSummaries ?? 20

  const [commissionerContext, sampleManagerSummaries, aiContext] = await Promise.all([
    buildCommissionerTrustContext(leagueId, { sport: options?.sport }),
    getUnifiedManagerSummaries({
      leagueId,
      sport: options?.sport ?? undefined,
      managerIds: null,
      entityIds: null,
      entityType: 'MANAGER',
    }).then((list) => list.slice(0, limit)),
    buildAIPrestigeContext(leagueId, options?.sport ?? undefined),
  ])

  return {
    commissionerContext,
    sampleManagerSummaries,
    aiContext,
  }
}

/** Re-export bridges and services for callers that need a single import. */
export { buildCommissionerTrustContext } from './CommissionerTrustBridge'
export { getHallOfFameEntryWithLegacy, getHallOfFameMomentWithLegacy } from './HallOfFameLegacyBridge'
export {
  getUnifiedManagerSummary,
  getUnifiedTeamSummary,
  getUnifiedManagerSummaries,
} from './UnifiedPrestigeQueryService'
export { buildAIPrestigeContext } from './AIPrestigeContextResolver'

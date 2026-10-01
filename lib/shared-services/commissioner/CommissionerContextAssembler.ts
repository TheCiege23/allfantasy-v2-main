/**
 * Commissioner Context Assembler — Phase 10.
 *
 * Composes ONE league's commissioner-facing context by reusing real, already-
 * live Decision OS federations directly — resolveMissionControlSnapshot() and
 * resolveLeagueAnalyticsSnapshot() (both already federate League Health +
 * trend + activity + retention risk; neither is recomputed here) — plus this
 * module's own genuinely new contribution: honest specialty-format awareness,
 * and optional enrichment from the Phase 9 Game Day service and the Phase 3
 * Knowledge Graph for the league's at-retention-risk managers.
 */

import { prisma } from '@/lib/prisma'
import { resolveMissionControlSnapshot } from '@/lib/decision-os/missionControl'
import { resolveLeagueAnalyticsSnapshot } from '@/lib/decision-os/leagueAnalytics'
import { getLeagueRole } from '@/lib/league/permissions'
import { buildLeagueGameDayContext } from '@/lib/shared-services/game-day/GameDayContextAssembler'
import { computeLineupAttention } from '@/lib/shared-services/game-day/LineupAttentionService'
import { getManagerBehaviorProfile } from '@/lib/shared-services/knowledge-graph/QueryService'
import type { CommissionerContext, FormatAwareness, ManagerTendencyContext } from './types'

/** Confirmed real stubs during the Phase 10 audit — never silently treated as live. */
const SPECIALTY_STUB_VARIANTS = new Set(['best_ball', 'bestball', 'keeper'])

function resolveFormatAwareness(leagueVariant: string | null, isDynasty: boolean): FormatAwareness {
  const normalized = (leagueVariant ?? '').toLowerCase()
  if (SPECIALTY_STUB_VARIANTS.has(normalized)) {
    return {
      leagueVariant,
      isDynasty,
      powerRankingSupport: 'specialty_adapter_required',
      reason: `${leagueVariant} power rankings are a confirmed preview-only stub in this codebase (lib/bestball/ai/powerRankings.ts or lib/keeper/ai/powerRankingsKeeper.ts) — not wired to real data.`,
    }
  }
  return { leagueVariant, isDynasty, powerRankingSupport: 'supported', reason: null }
}

export interface BuildCommissionerContextInput {
  leagueId: string
  requestingUserId: string
  /** Optional — when supplied, enriches the context with a real Game Day Lineup Attention pass for this viewer's roster in this league. */
  viewerUserId?: string
}

export async function buildCommissionerContext(input: BuildCommissionerContextInput): Promise<CommissionerContext> {
  const generatedAt = new Date().toISOString()

  const league = await prisma.league.findUnique({
    where: { id: input.leagueId },
    select: { leagueVariant: true, isDynasty: true },
  })

  const [role, missionControl, leagueAnalytics] = await Promise.all([
    getLeagueRole(input.leagueId, input.requestingUserId),
    resolveMissionControlSnapshot(input.leagueId),
    resolveLeagueAnalyticsSnapshot(input.leagueId),
  ])

  let gameDayAttentionItems: CommissionerContext['gameDayAttentionItems'] = null
  if (input.viewerUserId) {
    try {
      const leagueGameDayContext = await buildLeagueGameDayContext({ leagueId: input.leagueId, viewerUserId: input.viewerUserId })
      const { items } = await computeLineupAttention({ userId: input.viewerUserId, leagueContexts: [leagueGameDayContext] })
      gameDayAttentionItems = items
    } catch {
      gameDayAttentionItems = null
    }
  }

  const managerTendencies: Record<string, ManagerTendencyContext> = {}
  if (missionControl.leagueHealth.available) {
    for (const manager of missionControl.leagueHealth.result.decisionOs.managersAtRetentionRisk) {
      try {
        const result = await getManagerBehaviorProfile(manager.managerId)
        managerTendencies[manager.managerId] =
          result.status === 'gated'
            ? { status: 'gated', reason: result.reason, profile: null }
            : { status: 'ok', reason: null, profile: result.data }
      } catch (err) {
        managerTendencies[manager.managerId] = {
          status: 'unavailable',
          reason: err instanceof Error ? err.message : 'Knowledge Graph lookup failed.',
          profile: null,
        }
      }
    }
  }

  return {
    leagueId: input.leagueId,
    generatedAt,
    requestingUserRole: role,
    missionControl,
    leagueAnalytics,
    formatAwareness: resolveFormatAwareness(league?.leagueVariant ?? null, league?.isDynasty ?? false),
    gameDayAttentionItems,
    managerTendencies,
  }
}

/**
 * Decision OS — World Resolution for `commissioner.league.health` (Slice 4).
 *
 * READ-ONLY. Shapes the ALREADY-BUILT deterministic health snapshot (produced by the server-
 * authoritative assembler `getCommissionerHubHealthForUser` → `buildCommissionerHealthSnapshot` →
 * `monitorLeagueHealth`) into a neutral commissioner World. No prisma, no writes, no execution /
 * commissioner-action / AI-insight imports. The snapshot is the deterministic evaluation memo; the
 * World carries the surrounding league + metric context for the decision.
 *
 * Type-only import of the snapshot shape (erased at compile — no runtime coupling to the prisma-backed
 * assembler module).
 */
import type { CommissionerLeagueHealthSnapshot } from '@/lib/commissioner-hub/commissionerHubHealth'

export type CommissionerHealthSource = 'database' | 'dashboard-fallback'
export type CommissionerHealthDataConfidence = 'high' | 'medium' | 'low'

export interface CommissionerHealthWorld {
  leagueId: string
  leagueName: string
  sport: string
  season: number | string | null
  lifecycleState: string | null
  teamCount: number
  currentWeek: number
  /** Activity / engagement metrics (read-only, from the snapshot). */
  metrics: {
    activeManagers: number
    inactiveTeams: number
    abandonedTeams: number
    missedLineups: number
    injuredStarters: number
    tradeActivity: number
    waiverActivity: number
    pendingTrades: number
    pendingWaiverClaims: number
    chatMessagesLast7Days: number
    commissionerActions: number
    openAiAlerts: number
    lineupSubmissionRate: number
    projectionCoveragePct: number
  }
  nflDataCoverageKnown: boolean
  source: CommissionerHealthSource
  dataConfidence: CommissionerHealthDataConfidence
  provenance: 'snapshot'
  uncertainty: string | null
}

export interface CommissionerHealthWorldInput {
  snapshot: CommissionerLeagueHealthSnapshot
}

/** Pure, read-only World Resolution from the built snapshot. */
export function resolveCommissionerHealthWorld(input: CommissionerHealthWorldInput): CommissionerHealthWorld {
  const s = input.snapshot
  const inactiveTeams = s.metrics.inactiveTeams
  // Mirrors the engine's healthInput derivation (abandoned = inactive beyond the first).
  const abandonedTeams = Math.max(0, inactiveTeams - 1)
  return {
    leagueId: s.leagueId,
    leagueName: s.leagueName,
    sport: s.sport,
    season: s.season ?? null,
    lifecycleState: s.status ?? null,
    teamCount: s.teamCount,
    currentWeek: s.currentWeek,
    metrics: {
      activeManagers: s.metrics.activeManagers,
      inactiveTeams,
      abandonedTeams,
      missedLineups: s.metrics.missedLineups,
      injuredStarters: s.metrics.injuredStarters,
      tradeActivity: s.metrics.tradeActivity,
      waiverActivity: s.metrics.waiverActivity,
      pendingTrades: s.metrics.pendingTrades,
      pendingWaiverClaims: s.metrics.pendingWaiverClaims,
      chatMessagesLast7Days: s.metrics.chatMessagesLast7Days,
      commissionerActions: s.metrics.commissionerActions,
      openAiAlerts: s.metrics.openAiAlerts,
      lineupSubmissionRate: s.metrics.lineupSubmissionRate,
      projectionCoveragePct: s.metrics.projectionCoveragePct,
    },
    nflDataCoverageKnown: s.nflDataCoverage != null,
    source: s.source,
    dataConfidence: s.dataConfidence,
    provenance: 'snapshot',
    uncertainty:
      s.source === 'dashboard-fallback'
        ? 'Health computed from dashboard-fallback data (no live roster reads); confidence reduced.'
        : s.dataConfidence !== 'high'
          ? 'Some league inputs were incomplete; health confidence reduced.'
          : null,
  }
}

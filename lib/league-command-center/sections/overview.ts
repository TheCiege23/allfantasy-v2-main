import 'server-only'

/**
 * Overview section data — the role-aware landing page.
 *
 * League health comes from `resolveDecisionOsLeagueHealth`, the real Decision OS
 * behavioral resolver that federates live league events into the existing
 * `monitorLeagueHealth` scoring engine.
 *
 * **Honesty note that drives the whole shape of this module.** That engine
 * scores a `LeagueHealthInput` in which only *some* fields are derived from
 * real Decision OS signals; the rest fall back to schema defaults. The resolver
 * reports exactly which is which via `fieldProvenance`, precisely so callers do
 * not present a partly-defaulted composite as a fully-measured one. So this
 * loader carries `realSignalCount` / `totalSignalCount` through to the UI, and
 * the Overview renders the score with that coverage stated rather than as a
 * bare number.
 */
import type { DecisionOsLeagueHealthResult } from '@/lib/decision-os/leagueHealthAlignment'

export interface LeagueHealthSummary {
  available: boolean
  score: number
  engagementScore: number
  fairnessScore: number
  sustainabilityScore: number
  /** The engine's own confidence in the score, 0-100. */
  confidencePct: number
  overallStatus: string
  summary: string
  biggestStrengths: string[]
  biggestProblems: string[]
  urgentAlerts: string[]
  interventionRecommendations: string[]
  /** Real behavioral counts behind the score. */
  activeManagerCount: number
  inactiveManagerCount: number
  tradeCount: number
  waiverClaimCount: number
  managersAtRiskCount: number
  /** How many scoring inputs were real Decision OS signals vs schema defaults. */
  realSignalCount: number
  totalSignalCount: number
}

export interface OverviewSectionData {
  health: LeagueHealthSummary | null
  warnings: string[]
}

/**
 * Reshape a resolved `DecisionOsLeagueHealthResult` into the display summary.
 * Exported so the dedicated League Health section reuses the exact same
 * projection the Overview card uses — one mapping, so the two surfaces can
 * never present the same score differently.
 */
export function summarizeHealth(result: DecisionOsLeagueHealthResult): LeagueHealthSummary {
  const provenanceValues = Object.values(result.fieldProvenance)
  const realSignalCount = provenanceValues.filter((value) => value === 'decision_os').length

  return {
    available: true,
    score: result.engine.leagueHealthScore,
    engagementScore: result.engine.engagementScore,
    fairnessScore: result.engine.fairnessScore,
    sustainabilityScore: result.engine.sustainabilityScore,
    confidencePct: result.engine.confidencePct,
    overallStatus: String(result.engine.overallStatus),
    summary: result.engine.summary,
    biggestStrengths: result.engine.biggestStrengths.slice(0, 3),
    biggestProblems: result.engine.biggestProblems.slice(0, 3),
    urgentAlerts: result.engine.urgentAlerts.slice(0, 4),
    interventionRecommendations: result.engine.interventionRecommendations.slice(0, 4),
    activeManagerCount: result.decisionOs.activeManagerCount,
    inactiveManagerCount: result.decisionOs.inactiveManagerCount,
    tradeCount: result.decisionOs.tradeCount,
    waiverClaimCount: result.decisionOs.waiverClaimCount,
    managersAtRiskCount: result.decisionOs.managersAtRetentionRisk.length,
    realSignalCount,
    totalSignalCount: provenanceValues.length,
  }
}

export async function loadOverviewSection(args: {
  leagueId: string
  /**
   * League health is league-wide intelligence. When the viewer is not entitled,
   * skip the resolve entirely rather than loading it and hiding it — gated data
   * should never reach the client bundle.
   */
  includeHealth: boolean
  /**
   * An already-resolved health result, when the caller has one.
   *
   * `resolveMissionControlSnapshot` wraps the same `resolveDecisionOsLeagueHealth`
   * this loader would call, and that resolve federates league events and loops
   * every manager. A page rendering both Mission Control and the Overview would
   * otherwise pay for it twice — the exact per-league query fan-out shape behind
   * the production Postgres OOM. Passing the snapshot's result through keeps it
   * to one resolve; omitting it preserves the original standalone behaviour.
   */
  preResolvedHealth?: DecisionOsLeagueHealthResult | null
}): Promise<OverviewSectionData> {
  const warnings: string[] = []

  if (!args.includeHealth) {
    return { health: null, warnings }
  }

  if (args.preResolvedHealth) {
    return { health: summarizeHealth(args.preResolvedHealth), warnings }
  }

  try {
    const { resolveDecisionOsLeagueHealth } = await import('@/lib/decision-os/leagueHealthAlignment')
    const result = await resolveDecisionOsLeagueHealth(args.leagueId)
    return { health: summarizeHealth(result), warnings }
  } catch (error) {
    console.error('[command-center/overview] league health resolve failed', {
      leagueId: args.leagueId,
      error,
    })
    warnings.push('League health could not be calculated right now.')
    return { health: null, warnings }
  }
}

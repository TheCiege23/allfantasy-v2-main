/**
 * Fantasy OS Suite — Phase V8.4: production Decision OS evidence bridge + composition validation.
 *
 * A NARROW, read-only, deterministic, engineering-only bridge that lets the REAL production composition
 * functions execute against the persisted provider-neutral corpus. It reuses the pure composition
 * functions the product's DB-backed `resolve*Snapshot` wrappers already call (composeDailyBrief,
 * composeNotificationFeed, assemblePlatformRecommendations, assembleCommissionerRecommendations) — no
 * assembler was extracted, no production logic copied, no parallel Decision OS built. Subsystems whose
 * inputs the corpus cannot legitimately reconstruct (manager identity/patterns; DB-resolved state) are
 * reported BLOCKED with the exact missing contract — never fabricated.
 *
 * Boundaries: read-only, no writes, no Prisma, no provider terminology, no raw provider ids. This bridge
 * is engineering validation tooling; it is NOT an alternate production backend and is never imported by a
 * customer route.
 */
import { monitorLeagueHealth, type LeagueHealthResult } from '@/lib/league-health/league-health-engine'
import { deriveLeagueAttentionSignals, type DecisionOsAttentionSignal } from '@/lib/decision-os/attentionSignals'
import { composeDailyBrief } from '@/lib/decision-os/dailyBrief'
import { composeNotificationFeed } from '@/lib/decision-os/notifications'
import { assemblePlatformRecommendations, assembleCommissionerRecommendations } from '@/lib/decision-os/phase6/recommendations/recommendations'
import type { LeagueArchetypeSlice } from '@/lib/decision-os/phase6/recommendations/types'
import type { OperatingSystemKey } from '../types'
import type { PersistedLeagueEvidence } from '../persistence/evidenceStore'
import { toLeagueHealthInput } from '../decisionOsProbe'
import { fingerprint } from './provenance'

const FIXED_NOW = new Date('2025-01-01T00:00:00.000Z')

/** Narrow read-only port: exposes only the facts the pure composers need, provider-neutral + deterministic. */
export interface CompositionEvidencePort {
  listLeagueRefs(): string[]
  readLeagueHealth(ref: string): LeagueHealthResult | null
  readLeagueSignals(ref: string): DecisionOsAttentionSignal[]
  readPortfolioAggregates(): {
    totalLeagues: number
    healthyLeagueCount: number
    draftsApproachingCount: number
    inactiveLeagueFraction: number
    archetypeDistribution: Record<string, number>
  }
}

/** Health status → the phase-6 archetype label (a deterministic mapping from real health evidence). */
function archetypeLabel(health: LeagueHealthResult): LeagueArchetypeSlice {
  const label =
    health.overallStatus === 'at_risk' || health.overallStatus === 'critical'
      ? 'high_churn_risk'
      : health.overallStatus === 'watch'
        ? 'inactive_or_stale'
        : 'highly_engaged'
  return { label, confidence: Math.max(0, Math.min(1, health.confidencePct / 100)) }
}

/** The file/fixture-backed corpus port. Deterministic pure function of the persisted evidence. */
export class CorpusEvidencePort implements CompositionEvidencePort {
  private readonly byRef: Map<string, PersistedLeagueEvidence>
  constructor(private readonly leagues: PersistedLeagueEvidence[]) {
    this.byRef = new Map(leagues.filter((l) => !!l.facts).map((l) => [l.leagueReference, l]))
  }
  listLeagueRefs(): string[] {
    return [...this.byRef.keys()].sort()
  }
  readLeagueHealth(ref: string): LeagueHealthResult | null {
    const ev = this.byRef.get(ref)
    return ev?.facts ? monitorLeagueHealth(toLeagueHealthInput(ev.facts)) : null
  }
  readLeagueSignals(ref: string): DecisionOsAttentionSignal[] {
    const health = this.readLeagueHealth(ref)
    if (!health) return []
    return deriveLeagueAttentionSignals({
      leagueId: ref,
      now: FIXED_NOW,
      overallStatus: health.overallStatus,
      leagueHealthScore: health.leagueHealthScore,
      recommendedActions: [
        ...health.urgentAlerts.map((message) => ({ priority: 'urgent' as const, message })),
        ...health.interventionRecommendations.map((message) => ({ priority: 'standard' as const, message })),
      ],
      financialStatus: 'UNKNOWN',
      draftDateUtc: null,
    })
  }
  readPortfolioAggregates() {
    const refs = this.listLeagueRefs()
    let healthy = 0
    let inactive = 0
    const archetypeDistribution: Record<string, number> = {}
    for (const ref of refs) {
      const health = this.readLeagueHealth(ref)!
      if (health.overallStatus === 'excellent' || health.overallStatus === 'healthy') healthy++
      const slice = archetypeLabel(health)
      if (slice.label === 'inactive_or_stale' || slice.label === 'high_churn_risk') inactive++
      archetypeDistribution[slice.label] = (archetypeDistribution[slice.label] ?? 0) + 1
    }
    return {
      totalLeagues: refs.length,
      healthyLeagueCount: healthy,
      draftsApproachingCount: 0, // no real draft dates in the corpus — honestly zero, not fabricated
      inactiveLeagueFraction: refs.length ? inactive / refs.length : 0,
      archetypeDistribution,
    }
  }
}

// ── Composition execution matrix ──────────────────────────────────────────────

export type CompositionStatus =
  | 'production-parity-executed'
  | 'pure-derivation-executed'
  | 'compatibility-only'
  | 'blocked-unavailable-evidence'
  | 'blocked-product-state'
  | 'failed'

export type CompositionExecution = {
  subsystem: string
  entryPoint: string
  status: CompositionStatus
  owner: OperatingSystemKey
  inputAvailability: 'complete' | 'partial' | 'unavailable'
  outputStatus: 'produced' | 'empty' | 'unavailable'
  producedCount: number
  missingEvidence: string[]
  inputFingerprint: string
  detail: string
}

/** Execute every legitimately-reachable production composition function via the port; report the rest. */
export function runCompositionValidation(port: CompositionEvidencePort): CompositionExecution[] {
  const out: CompositionExecution[] = []
  const refs = port.listLeagueRefs()
  const agg = port.readPortfolioAggregates()
  const allSignals = refs.flatMap((ref) => port.readLeagueSignals(ref))

  // Daily Brief — REAL production composition (composeDailyBrief), fed corpus-derived inputs.
  const briefInput = {
    leaguesMonitored: agg.totalLeagues,
    healthyLeagueCount: agg.healthyLeagueCount,
    draftsApproachingCount: agg.draftsApproachingCount,
    signals: allSignals,
    leagueTrends: [], // no real per-league trend history in the corpus — honestly empty
  }
  const brief = composeDailyBrief(briefInput, FIXED_NOW)
  const briefItems = brief.topPriorityItems.length + brief.recommendedActions.length
  out.push({
    subsystem: 'Daily Brief', entryPoint: 'composeDailyBrief',
    status: 'production-parity-executed', owner: 'platform',
    inputAvailability: 'partial', // draftsApproaching + trends unavailable from the corpus
    // A valid empty/healthy brief is a legitimate outcome — not a failure, not fabricated work.
    outputStatus: brief.isHealthy && briefItems === 0 ? 'empty' : 'produced', producedCount: briefItems,
    missingEvidence: ['draft-dates', 'league-trend-history'],
    inputFingerprint: fingerprint(briefInput),
    detail: 'real Daily Brief composition executed over corpus-derived attention signals + health aggregates',
  })

  // Notification feed — REAL production composition (composeNotificationFeed).
  const notifications = composeNotificationFeed({ signals: allSignals, brief })
  out.push({
    subsystem: 'Notification Feed', entryPoint: 'composeNotificationFeed',
    status: 'production-parity-executed', owner: 'platform',
    inputAvailability: 'complete', outputStatus: notifications.length ? 'produced' : 'empty',
    producedCount: notifications.length, missingEvidence: [],
    inputFingerprint: fingerprint({ signals: allSignals.length, brief: briefItems }),
    detail: 'real notification composition executed over corpus-derived signals + brief',
  })

  // Platform recommendations — REAL production composition (assemblePlatformRecommendations).
  const platformInput = {
    platformId: 'validation-corpus',
    totalLeagues: agg.totalLeagues,
    inactiveLeagueFraction: agg.inactiveLeagueFraction,
    archetypeDistribution: agg.archetypeDistribution,
  }
  const platformRecs = assemblePlatformRecommendations(platformInput)
  out.push({
    subsystem: 'Platform Recommendations', entryPoint: 'assemblePlatformRecommendations',
    status: 'production-parity-executed', owner: 'platform',
    inputAvailability: 'partial', // engagement/churn-risk fractions unavailable from the corpus
    outputStatus: platformRecs.recommendations.length ? 'produced' : 'empty',
    producedCount: platformRecs.recommendations.length,
    missingEvidence: ['low-engagement-fraction', 'high-churn-risk-fraction'],
    inputFingerprint: fingerprint(platformInput),
    detail: 'real platform recommendation assembly executed over corpus portfolio aggregates',
  })

  // Commissioner recommendations — REAL production composition, per league, with a health-derived archetype slice.
  let commissionerCount = 0
  for (const ref of refs) {
    const health = port.readLeagueHealth(ref)!
    const recs = assembleCommissionerRecommendations({ leagueId: ref, archetype: archetypeLabel(health) })
    commissionerCount += recs.recommendations.length
  }
  out.push({
    subsystem: 'Commissioner Recommendations', entryPoint: 'assembleCommissionerRecommendations',
    status: 'production-parity-executed', owner: 'commissioner',
    inputAvailability: 'partial', // only the archetype slice is available; benchmark/signals/patterns are not
    outputStatus: commissionerCount ? 'produced' : 'empty', producedCount: commissionerCount,
    missingEvidence: ['benchmark-slice', 'league-signals-slice', 'league-pattern-slice'],
    inputFingerprint: fingerprint({ refs, archetypes: agg.archetypeDistribution }),
    detail: 'real commissioner recommendation assembly executed with a health-derived archetype slice',
  })

  // Manager recommendations — BLOCKED: needs manager identity + behavioral patterns the corpus can't
  // legitimately reconstruct (and Part 6 forbids inferring). Never fabricated.
  out.push({
    subsystem: 'Manager Recommendations', entryPoint: 'assembleManagerRecommendations',
    status: 'blocked-unavailable-evidence', owner: 'manager',
    inputAvailability: 'unavailable', outputStatus: 'unavailable', producedCount: 0,
    missingEvidence: ['manager-identity', 'behavioral-patterns', 'cross-league-roster-ownership-mapping'],
    inputFingerprint: fingerprint('manager-recs-blocked'),
    detail: 'requires a legitimate manager identity + behavioral-pattern contract; not reconstructable from the corpus',
  })

  // DB-backed resolvers — BLOCKED by product state (they fetch DB-assembled inputs; the pure inner
  // composition they call is what is validated above).
  for (const [subsystem, entryPoint, owner] of [
    ['Mission Control', 'resolveMissionControlSnapshot', 'platform'],
    ['Manager Command Center', 'resolveManagerCommandCenterSnapshot', 'manager'],
    ['League Analytics', 'resolveLeagueAnalyticsSnapshot', 'league'],
  ] as const) {
    out.push({
      subsystem, entryPoint, status: 'blocked-product-state', owner,
      inputAvailability: 'unavailable', outputStatus: 'unavailable', producedCount: 0,
      missingEvidence: ['db-resolved-inputs'],
      inputFingerprint: fingerprint(entryPoint),
      detail: 'DB-backed resolver; its pure inner composition is validated separately — the resolver itself is not run over a file corpus',
    })
  }

  return out
}

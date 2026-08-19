/**
 * Decision OS — Phase 8.1 Intelligence Pipeline Unification.
 *
 * Composes the ALREADY-REAL, already-tested Phase 5.1-5.2 behavioral pipeline
 * with the ALREADY-REAL Phase 6.1/6.2/6.4 decision intelligence layer to
 * produce a real Manager DNA profile + Manager Recommendation set for one
 * manager in one league. Every building block here is imported unchanged
 * from its own file — this module adds ZERO new derivation logic, only
 * composition (loads real rows -> maps to events -> assembles facts ->
 * derives behavioral intelligence -> detects patterns -> assembles DNA ->
 * assembles recommendations).
 *
 * Read-only: only reads via the existing Phase 5.1 port functions (the same
 * ones `lib/decision-os/behavioral/api/real-data-provider.ts` already uses
 * for the live Intelligence API). No writes, no cache-warming.
 *
 * Server-only: performs real Prisma reads via the port layer. Call from a
 * Server Component, a Route Handler, or another server-only module — never
 * from a Client Component directly.
 *
 * Honest degradation (P2): a manager with zero events still gets a real
 * (not fabricated) profile — every count is genuinely 0, `primaryIdentity`
 * naturally resolves to 'unknown', and `buildManagerDnaViewModel`/
 * `buildDecisionRecommendationsViewModel` already render that as an honest
 * insufficient-data state. Nothing here invents data when a source is thin.
 *
 * Deferred (documented, not built here — see PHASE_8_1_PIPELINE_UNIFICATION.md):
 * `leagueBenchmark` (Phase 6.5) is intentionally omitted from the DNA/
 * recommendation inputs — platform-wide cross-league benchmarking is a
 * separate, heavier composition out of this ticket's scope. Commissioner-
 * tier recommendations (Phase 6.4 `assembleCommissionerRecommendations`)
 * are also deferred — this module only produces MANAGER-tier output.
 */

import {
  loadWaiverClaimRows,
  loadLeagueTradeRows,
  loadRosterMoveRows,
  loadDraftRows,
  loadRedraftTradeRows,
  loadRedraftRosterPlayerRows,
  loadRedraftRosterMoveRows,
} from '@/lib/decision-os/behavioral/port'
import {
  mapWaiverClaimsToEvents,
  mapLeagueTradesToEvents,
  mapRosterMovesToEvents,
  mapDraftRowsToEvents,
  mapRedraftTradesToEvents,
  mapRedraftRosterPlayersToEvents,
  mapRedraftRosterMovesToEvents,
} from '@/lib/decision-os/behavioral/mappers'
import { mapImportedActivityRowsToEvents } from '@/lib/decision-os/behavioral/importedActivityToEvents'
import { defaultLoadImportedActivityRows } from '@/lib/decision-os/behavioral/api/real-data-provider'
import { defaultListLeagueBehavioralTrend } from '@/lib/decision-os/snapshot/prismaBehavioralSnapshotStore'
import { deriveBehavioralTrend, deriveEventCountDelta } from '@/lib/decision-os/snapshot/behavioralTrend'
import type { BehavioralSnapshotRecord } from '@/lib/decision-os/snapshot/behavioralSnapshotCapture'
import {
  assembleManagerBehavioralFacts,
  assembleLeagueBehavioralFacts,
} from '@/lib/decision-os/behavioral/assemble'
import { deriveManagerBehavioralIntelligence } from '@/lib/decision-os/behavioral/manager-intelligence'
import type { ManagerBehavioralIntelligence, ParticipationTier } from '@/lib/decision-os/behavioral/manager-intelligence'
import type { BehavioralEvent } from '@/lib/decision-os/behavioral/events/types'
import {
  detectBehavioralPatterns,
  assembleManagerDna,
  assembleManagerRecommendations,
} from '@/lib/decision-os/phase6'
import type {
  ManagerDnaProfile,
  ManagerSignalInput,
  ManagerEngagementTier,
} from '@/lib/decision-os/phase6/dna/types'
import type { RecommendationSet } from '@/lib/decision-os/phase6/recommendations/types'

export function lookbackDays(): number {
  return Math.max(1, parseInt(process.env.INTELLIGENCE_LOOKBACK_DAYS ?? '90', 10) || 90)
}

export function sinceDate(days: number): Date {
  const d = new Date()
  d.setDate(d.getDate() - days)
  return d
}

/**
 * Same event-loading shape as real-data-provider.ts's loadAllLeagueEvents, plus
 * the Phase 2E redraft trade/roster sources (docs/DECISION_OS_MANAGER_DNA_PHASE2D_REAL_DATA_READINESS.md)
 * and the Phase 2H redraft lineup-history source (docs/DECISION_OS_MANAGER_DNA_PHASE2G_VOLUME_AND_LINEUP_HISTORY_SCOPE.md):
 * the live redraft product writes to RedraftTradeProposal/RedraftTradeAsset and
 * RedraftRoster/RedraftRosterPlayer, not AfLeagueTrade/AfRosterMoveHistory — so
 * without these additional sources, real redraft trade and roster activity
 * would never reach this pipeline at all. `redraftRosterMoveRows` (Phase 2H)
 * is the only source with a real, non-null week — everything else composed
 * here is unchanged.
 *
 * Commissioner OS Surface Alignment (Phase B Increment 1): also merges imported/
 * external-league activity (Decision OS Phase A) via the SAME
 * `defaultLoadImportedActivityRows`/`mapImportedActivityRowsToEvents` real-data-provider.ts
 * uses — so this surface (which real UI already calls: Commissioner Hub, Dashboard
 * Overview, LeagueTab) reflects imported Sleeper/external activity too, including managers
 * with no AllFantasy account. Purely additive; degrades to `[]` honestly if no imported
 * activity exists for this league (never fabricated).
 */
export async function loadLeagueEvents(leagueId: string, since: Date): Promise<BehavioralEvent[]> {
  const [
    waiverRows,
    tradeRows,
    rosterMoveRows,
    draftData,
    redraftTradeRows,
    redraftRosterPlayerRows,
    redraftRosterMoveRows,
    importedActivityRows,
  ] = await Promise.all([
    loadWaiverClaimRows(leagueId, since),
    loadLeagueTradeRows(leagueId, since),
    loadRosterMoveRows(leagueId, since),
    loadDraftRows(leagueId),
    loadRedraftTradeRows(leagueId, since),
    loadRedraftRosterPlayerRows(leagueId, since),
    loadRedraftRosterMoveRows(leagueId, since),
    defaultLoadImportedActivityRows(leagueId, since),
  ])
  return [
    ...mapWaiverClaimsToEvents(waiverRows),
    ...mapLeagueTradesToEvents(tradeRows),
    ...mapRosterMovesToEvents(rosterMoveRows),
    ...mapDraftRowsToEvents(draftData.session, draftData.picks),
    ...mapRedraftTradesToEvents(redraftTradeRows),
    ...mapRedraftRosterPlayersToEvents(redraftRosterPlayerRows),
    ...mapRedraftRosterMovesToEvents(redraftRosterMoveRows),
    ...mapImportedActivityRowsToEvents(importedActivityRows).events,
  ]
}

/** Phase 5.2 ParticipationTier -> Phase 6.2 ManagerEngagementTier. Only the bottom label differs. */
function toEngagementTier(tier: ParticipationTier): ManagerEngagementTier {
  return tier === 'inactive' ? 'dormant' : tier
}

/** Honest per-week rate from a real event count over the real lookback window. Never estimated when the count is 0. */
function perWeekRate(eventCount: number, lookback: number | null): number {
  const weeks = Math.max(1, (lookback ?? lookbackDays()) / 7)
  return Math.round((eventCount / weeks) * 100) / 100
}

function toManagerSignal(mi: ManagerBehavioralIntelligence): ManagerSignalInput {
  return {
    managerId: mi.managerId,
    engagementScore: mi.overallEngagementScore,
    engagementTier: toEngagementTier(mi.participationTier),
    activityRates: {
      lineupEditsPerWeek: perWeekRate(mi.lineupEngagement.eventCount, mi.lookbackDays),
      waiverClaimsPerWeek: perWeekRate(mi.waiverEngagement.eventCount, mi.lookbackDays),
      tradeProposalsPerWeek: perWeekRate(mi.tradeEngagement.eventCount, mi.lookbackDays),
      // Honest 0 — this pipeline has no login/session event source (matches the
      // existing Phase 5.2 convention: every zero here is a real absence, not a fill-in).
      loginSessionsPerWeek: 0,
    },
    completeness: mi.completeness,
  }
}

/**
 * Commissioner OS Surface Alignment (Phase B Increment 2): league-level activity trend, derived
 * from Decision OS Phase A's behavioral snapshots (Increment 5). Read-only — this does NOT write
 * new snapshots (that is a separate, not-yet-built scheduler's job, per the Phase A doc).
 *
 * Honest by construction: `direction` describes ACTIVITY VOLUME movement (event count period over
 * period), not a value judgment like "healthier" — this codebase's league-health *score* is a
 * separate, not-yet-aligned system (subsystem C, see docs/os/COMMISSIONER_OS_SURFACE_ALIGNMENT.md).
 * Fewer than 2 captured periods is reported as `unavailable` with a reason — never a fabricated
 * trend line, matching `deriveEventCountDelta`'s own "< 2 points → null" contract.
 */
export type LeagueActivityTrendSummary =
  | { available: false; reason: 'no_snapshots' | 'insufficient_history' }
  | {
      available: true
      periodsTracked: number
      earliestPeriodKey: string
      latestPeriodKey: string
      latestEventCount: number
      latestManagerCount: number
      eventCountDelta: number
      direction: 'increasing' | 'decreasing' | 'flat'
    }

/** Resolve the league-scope activity trend. Never throws — degrades to `available: false`. */
export async function resolveLeagueActivityTrend(leagueId: string): Promise<LeagueActivityTrendSummary> {
  try {
    const records: BehavioralSnapshotRecord[] = await defaultListLeagueBehavioralTrend(leagueId)
    const trend = deriveBehavioralTrend(records)

    if (trend.length === 0) return { available: false, reason: 'no_snapshots' }
    if (trend.length < 2) return { available: false, reason: 'insufficient_history' }

    const delta = deriveEventCountDelta(trend)
    if (delta === null) return { available: false, reason: 'insufficient_history' }

    const byPeriod = new Map(records.map((r) => [r.periodKey, r]))
    const latest = trend[trend.length - 1]
    const latestRecord = byPeriod.get(latest.periodKey)
    const latestManagerCount =
      latestRecord?.scope === 'league' ? latestRecord.facts.activeManagerIds.length : 0

    return {
      available: true,
      periodsTracked: trend.length,
      earliestPeriodKey: trend[0].periodKey,
      latestPeriodKey: latest.periodKey,
      latestEventCount: latest.eventCount,
      latestManagerCount,
      eventCountDelta: delta,
      direction: delta > 0 ? 'increasing' : delta < 0 ? 'decreasing' : 'flat',
    }
  } catch {
    return { available: false, reason: 'no_snapshots' }
  }
}

export type ManagerIntelligencePayload = {
  managerDna: ManagerDnaProfile | null
  recommendations: RecommendationSet | null
  /** Additive (Phase B Increment 2) — never affects managerDna/recommendations either way. */
  leagueTrend: LeagueActivityTrendSummary
}

/**
 * Resolve a real Manager DNA profile + Manager Recommendation set for one
 * manager in one league, via the real Phase 5.1/5.2 -> 6.1/6.2/6.4 pipeline.
 *
 * Always computes facts for `managerId` even if they have zero events (an
 * honest zero-activity profile, not a skipped one). Other active managers'
 * signals/patterns are included too, since Phase 6.1 pattern detection and
 * Phase 6.2 DNA classification both take the full league's manager set as
 * input — matching the exact composition already proven by
 * `real-data-provider.ts`'s `buildLeaguePipeline`.
 */
export async function resolveManagerIntelligencePayload({
  leagueId,
  managerId,
  now = new Date(),
}: {
  leagueId: string
  managerId: string
  now?: Date
}): Promise<ManagerIntelligencePayload> {
  // Resolved independently of the DNA/Recommendations computation below: `resolveLeagueActivityTrend`
  // never throws (fully self-contained), so a trend-read hiccup can never affect managerDna/
  // recommendations, and a DNA/Recommendations failure below can never suppress a real trend result.
  const leagueTrend = await resolveLeagueActivityTrend(leagueId)

  try {
    const lookback = lookbackDays()
    const since = sinceDate(lookback)
    const events = await loadLeagueEvents(leagueId, since)

    const leagueFacts = assembleLeagueBehavioralFacts({ leagueId, events, lookbackDays: lookback })
    const managerIds = new Set(leagueFacts.activeManagerIds)
    managerIds.add(managerId)

    const managerIntelligences: ManagerBehavioralIntelligence[] = [...managerIds].map((id) => {
      const facts = assembleManagerBehavioralFacts({ managerId: id, leagueId, events, lookbackDays: lookback })
      return deriveManagerBehavioralIntelligence(facts, events, now)
    })

    const patternsResult = detectBehavioralPatterns({ leagueId, events, analysisWindowDays: lookback })

    const managerSignals: ManagerSignalInput[] = managerIntelligences.map(toManagerSignal)

    const dnaResult = assembleManagerDna({
      leagueId,
      managerPatterns: patternsResult.managerPatterns,
      managerSignals,
    })

    const targetProfile = dnaResult.profiles.find((p) => p.managerId === managerId) ?? null
    const targetPatternGroup = patternsResult.managerPatterns.find((g) => g.managerId === managerId)

    const recommendations = assembleManagerRecommendations({
      managerId,
      leagueId,
      identity: targetProfile ?? undefined,
      patterns: targetPatternGroup?.patterns,
      // leagueBenchmark intentionally omitted — Phase 6.5 platform-wide
      // benchmarking is out of this ticket's scope (documented deferral).
    })

    return { managerDna: targetProfile, recommendations, leagueTrend }
  } catch {
    // Degraded-safe, matching real-data-provider.ts's own contract: a
    // failure here must never break the page. Callers already handle
    // `null` as "insufficient data" via buildManagerDnaViewModel/
    // buildDecisionRecommendationsViewModel's existing fallback paths.
    // leagueTrend is independent of this failure — still returned honestly.
    return { managerDna: null, recommendations: null, leagueTrend }
  }
}

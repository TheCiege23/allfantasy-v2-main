/**
 * Decision OS — Phase 2 / F2.8: League Intelligence Foundation (read-only derived VIEW).
 *
 * Additive, read-only view layering on F2.1 EnrichedCanonicalWorld. Exposes deterministic
 * league-level intelligence signals: health score, manager participation, roster completeness,
 * waiver/trade/lineup activity, commissioner workload, and honest degradation via null + uncertainty[].
 *
 * Architecture Freeze invariants (must hold forever):
 * - Pure `CanonicalWorld` is NOT mutated. All league intelligence lives on this derived view only.
 * - Origin (provider / native) is NEVER used as a decision input. Provenance only.
 * - No live API calls, no cache warming, no writes. Port issues count queries only.
 * - Health score is transparent arithmetic (documented in ADR_F2_8 §3) — no AI, no ML.
 * - P3: no AI-generated summaries. All signals are deterministic from persisted rows.
 * - All fields degrade to null + uncertainty[] when data is unavailable (P2 — never fabricate).
 * - `resolveLeagueIntelEnrichedCanonicalWorld` NEVER throws.
 * - No server-only imports (P1 substrate purity).
 *
 * See ADR_F2_8_LEAGUE_INTELLIGENCE.md for source audit, health score algorithm,
 * activity tier classification, and real-data coverage findings.
 */

import type { EnrichedCanonicalWorld } from './enrichedWorld'
import { resolveEnrichedCanonicalWorld } from './enrichedWorld'
import type { RawLeagueActivityCounts, RawLeagueReputationRow, TeamFacts, RosterFacts } from './facts'
import { loadLeagueActivityCounts, loadLeagueReputation } from './port'

// ──────────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────────

export type LeagueHealthTier = 'healthy' | 'at_risk' | 'inactive' | 'unknown'
export type LeagueActivityTier = 'high' | 'moderate' | 'low' | 'inactive' | 'unknown'
export type LeagueEngagementTier = 'high' | 'moderate' | 'low' | 'inactive' | 'unknown'

export interface LeagueHealthScore {
  /** 0–100 deterministic score. Null only when teams array is empty. */
  score: number | null
  tier: LeagueHealthTier
  /** Named factors that contributed to the score (transparency). */
  basis: string[]
}

export interface ManagerParticipationSignal {
  totalManagers: number
  /** Non-orphan teams. */
  activeManagers: number
  orphanCount: number
  /** 0–1 fraction. */
  orphanRate: number
  /** 0–1 fraction of non-orphan managers. */
  participationRate: number
}

export interface RosterCompletenessSignal {
  totalRosters: number
  /** Rosters with playerCount === 0. */
  emptyRosters: number
  /** Rosters with playerCount < expectedMinimum (when rosterSize is known). */
  underfilledRosters: number
  /** 0–1 fraction of rosters that meet the expected minimum. */
  completenessRate: number
  /** From leagueFacts.rosterSettings.rosterSize — null when unknown. */
  expectedMinimum: number | null
}

export interface ActivitySignal {
  count: number
  lookbackDays: number
  tier: LeagueActivityTier
  available: boolean
}

export interface CommissionerWorkloadSignal {
  commissionerCount: number
  coCommissionerCount: number
  /** True when a commissioner-flagged team is also marked orphan. */
  isOrphanCommissioner: boolean
  /** lockAllMoves from league settings (carried from LeagueFacts.settings opaque blob — null when not parseable). */
  lockAllMoves: boolean | null
}

export interface LeagueReputationCarry {
  /** Precomputed overall score (0–1 scale from LeagueReputation.overallScore). Provenance only. */
  overallScore: number | null
  tier: string | null
  totalSeasons: number
  lastComputedAt: Date
}

export interface LeagueIntelFreshness {
  computedAt: Date
  worldLastSyncedAt: string | null
  isWorldStale: boolean
}

export interface LeagueIntelContext {
  healthScore: LeagueHealthScore
  managerParticipation: ManagerParticipationSignal
  rosterCompleteness: RosterCompletenessSignal
  waiverActivity: ActivitySignal
  tradeActivity: ActivitySignal
  lineupActivity: ActivitySignal
  engagementTier: LeagueEngagementTier
  commissionerWorkload: CommissionerWorkloadSignal
  /** Precomputed reputation — provenance only, not used in health scoring. */
  leagueReputation: LeagueReputationCarry | null
  inactivityWarnings: string[]
  engagementWarnings: string[]
  freshness: LeagueIntelFreshness
  uncertainty: string[]
}

export interface LeagueIntelEnrichedCanonicalWorld extends EnrichedCanonicalWorld {
  leagueIntelligence: LeagueIntelContext
}

export interface LeagueIntelPort {
  loadLeagueActivityCounts(leagueId: string, since: Date, lookbackDays: number): Promise<RawLeagueActivityCounts>
  loadLeagueReputation(leagueId: string): Promise<RawLeagueReputationRow | null>
}

export interface LeagueIntelEnrichedWorldDeps {
  intel?: LeagueIntelPort
  now?: Date
  /** Look-back window for activity counts. Default: 30 days. */
  lookbackDays?: number
}

// ──────────────────────────────────────────────────────────────────────────
// Constants
// ──────────────────────────────────────────────────────────────────────────

const DEFAULT_LOOKBACK_DAYS = 30
const HIGH_ACTIVITY_PER_WEEK = 3
const MODERATE_ACTIVITY_PER_WEEK = 1

// ──────────────────────────────────────────────────────────────────────────
// Pure helpers
// ──────────────────────────────────────────────────────────────────────────

/** Derive activity tier from a count + lookback window. Pure, never throws. */
export function deriveActivityTier(count: number, lookbackDays: number): LeagueActivityTier {
  if (lookbackDays <= 0) return 'unknown'
  const perWeek = count / (lookbackDays / 7)
  if (perWeek >= HIGH_ACTIVITY_PER_WEEK) return 'high'
  if (perWeek >= MODERATE_ACTIVITY_PER_WEEK) return 'moderate'
  if (perWeek > 0) return 'low'
  return 'inactive'
}

/** Derive league-level engagement tier from three activity signals. Pure. */
export function deriveEngagementTier(
  waiver: LeagueActivityTier,
  trade: LeagueActivityTier,
  lineup: LeagueActivityTier,
): LeagueEngagementTier {
  const tiers = [waiver, trade, lineup]
  if (tiers.every((t) => t === 'unknown')) return 'unknown'
  if (tiers.some((t) => t === 'high')) return 'high'
  if (tiers.some((t) => t === 'moderate')) return 'moderate'
  const nonUnknown = tiers.filter((t) => t !== 'unknown')
  if (nonUnknown.every((t) => t === 'inactive')) return 'inactive'
  return 'low'
}

/** Project manager participation from team facts. Pure. */
export function projectManagerParticipation(teams: TeamFacts[]): ManagerParticipationSignal {
  const total = teams.length
  const orphanCount = teams.filter((t) => t.isOrphan).length
  const activeManagers = total - orphanCount
  const orphanRate = total > 0 ? orphanCount / total : 0
  const participationRate = total > 0 ? activeManagers / total : 0
  return { totalManagers: total, activeManagers, orphanCount, orphanRate, participationRate }
}

/** Project roster completeness from rosters + expected size. Pure. */
export function projectRosterCompleteness(
  rosters: RosterFacts[],
  expectedMinimum: number | null,
): RosterCompletenessSignal {
  const totalRosters = rosters.length
  const emptyRosters = rosters.filter((r) => r.playerCount === 0).length
  let underfilledRosters = 0
  if (expectedMinimum !== null && expectedMinimum > 0) {
    underfilledRosters = rosters.filter((r) => r.playerCount < expectedMinimum).length
  }
  const shortfall = expectedMinimum !== null ? underfilledRosters : emptyRosters
  const completenessRate = totalRosters > 0 ? Math.max(0, (totalRosters - shortfall) / totalRosters) : 1
  return { totalRosters, emptyRosters, underfilledRosters, completenessRate, expectedMinimum }
}

/** Project commissioner workload from team facts + world settings. Pure. */
export function projectCommissionerWorkload(
  teams: TeamFacts[],
  lockAllMoves: boolean | null,
): CommissionerWorkloadSignal {
  const commissionerCount = teams.filter((t) => t.isCommissioner).length
  const coCommissionerCount = teams.filter((t) => t.isCoCommissioner).length
  const isOrphanCommissioner = teams.some((t) => t.isCommissioner && t.isOrphan)
  return { commissionerCount, coCommissionerCount, isOrphanCommissioner, lockAllMoves }
}

/**
 * Compute the deterministic league health score (0–100). Pure.
 * Algorithm documented in ADR_F2_8 §3.
 */
export function projectLeagueHealthScore(
  participation: ManagerParticipationSignal,
  completeness: RosterCompletenessSignal,
  isWorldStale: boolean,
): LeagueHealthScore {
  if (participation.totalManagers === 0) {
    return { score: null, tier: 'unknown', basis: ['empty_league'] }
  }

  const basis: string[] = []
  const orphanPenalty = Math.round(participation.orphanRate * 30)
  const rosterPenalty = Math.round((1 - completeness.completenessRate) * 20)
  const stalePenalty = isWorldStale ? 10 : 0

  if (orphanPenalty > 0) basis.push('orphan_teams')
  if (rosterPenalty > 0) basis.push('incomplete_rosters')
  if (stalePenalty > 0) basis.push('sync_stale')

  const score = Math.max(0, 100 - orphanPenalty - rosterPenalty - stalePenalty)
  let tier: LeagueHealthTier
  if (score >= 80 && participation.orphanRate < 0.20) {
    tier = 'healthy'
  } else if (score >= 50 && participation.orphanRate < 0.40) {
    tier = 'at_risk'
  } else {
    tier = 'inactive'
  }

  return { score, tier, basis }
}

/** Build inactivity warnings from canonical signals. Pure. */
export function buildInactivityWarnings(
  participation: ManagerParticipationSignal,
  completeness: RosterCompletenessSignal,
  commWorkload: CommissionerWorkloadSignal,
): string[] {
  const warnings: string[] = []
  if (participation.orphanCount > 0) warnings.push('orphan_teams_detected')
  if (participation.orphanRate >= 0.5) warnings.push('majority_orphan')
  if (completeness.emptyRosters > 0) warnings.push('empty_rosters_detected')
  if (completeness.totalRosters > 0 && completeness.emptyRosters === completeness.totalRosters) {
    warnings.push('all_rosters_empty')
  }
  if (commWorkload.isOrphanCommissioner) warnings.push('orphan_commissioner')
  return warnings
}

/** Build engagement warnings from activity signals. Pure. */
export function buildEngagementWarnings(
  waiver: ActivitySignal,
  trade: ActivitySignal,
  lineup: ActivitySignal,
): string[] {
  const warnings: string[] = []
  if (waiver.available && waiver.tier === 'inactive') warnings.push('no_waiver_activity')
  if (trade.available && trade.tier === 'inactive') warnings.push('no_trade_activity')
  if (lineup.available && lineup.tier === 'inactive') warnings.push('no_lineup_activity')
  const allLow = [waiver, trade, lineup].every(
    (s) => !s.available || s.tier === 'low' || s.tier === 'inactive',
  )
  if (allLow && [waiver, trade, lineup].some((s) => s.available)) {
    warnings.push('all_activity_low')
  }
  return warnings
}

/**
 * Pure projector: fold league intelligence context onto an EnrichedCanonicalWorld.
 * Never mutates the base world. Never throws.
 */
export function projectLeagueIntelEnrichedWorld(
  world: EnrichedCanonicalWorld,
  activityResult: { counts: RawLeagueActivityCounts | null; error: string | null },
  reputationResult: { row: RawLeagueReputationRow | null; error: string | null },
  now: Date,
): LeagueIntelEnrichedCanonicalWorld {
  const uncertainty: string[] = []
  const isWorldStale = world.provenance.freshness.isStale

  if (isWorldStale) uncertainty.push('sync_stale')
  if (world.teams.length === 0) uncertainty.push('empty_league')
  if (world.rosters.length === 0) uncertainty.push('no_rosters')

  // Canonical-world derived signals (no DB reads)
  const participation = projectManagerParticipation(world.teams)
  const expectedMinimum = world.league.rosterSettings.rosterSize
  const completeness = projectRosterCompleteness(world.rosters, expectedMinimum)

  // lockAllMoves from opaque settings blob — try to read it safely
  let lockAllMoves: boolean | null = null
  try {
    const settings = world.league.scoringSettings as Record<string, unknown> | null
    if (settings && typeof settings['lockAllMoves'] === 'boolean') {
      lockAllMoves = settings['lockAllMoves']
    }
  } catch {
    // opaque blob — not readable
  }

  const commWorkload = projectCommissionerWorkload(world.teams, lockAllMoves)
  const healthScore = projectLeagueHealthScore(participation, completeness, isWorldStale)

  // Activity signals (from port counts)
  let waiverActivity: ActivitySignal
  let tradeActivity: ActivitySignal
  let lineupActivity: ActivitySignal

  if (activityResult.error || !activityResult.counts) {
    uncertainty.push('activity_data_unavailable')
    const unavailable: ActivitySignal = { count: 0, lookbackDays: DEFAULT_LOOKBACK_DAYS, tier: 'unknown', available: false }
    waiverActivity = unavailable
    tradeActivity = unavailable
    lineupActivity = unavailable
  } else {
    const c = activityResult.counts
    waiverActivity = {
      count: c.waiverClaimCount,
      lookbackDays: c.lookbackDays,
      tier: deriveActivityTier(c.waiverClaimCount, c.lookbackDays),
      available: true,
    }
    tradeActivity = {
      count: c.tradeCount,
      lookbackDays: c.lookbackDays,
      tier: deriveActivityTier(c.tradeCount, c.lookbackDays),
      available: true,
    }
    lineupActivity = {
      count: c.rosterMoveCount,
      lookbackDays: c.lookbackDays,
      tier: deriveActivityTier(c.rosterMoveCount, c.lookbackDays),
      available: true,
    }
  }

  // Reputation carry (provenance only)
  if (reputationResult.error) uncertainty.push('reputation_unavailable')
  const leagueReputation: LeagueReputationCarry | null = reputationResult.row
    ? {
        overallScore: reputationResult.row.overallScore,
        tier: reputationResult.row.tier,
        totalSeasons: reputationResult.row.totalSeasons,
        lastComputedAt: reputationResult.row.lastComputedAt,
      }
    : null
  if (!leagueReputation && !reputationResult.error) uncertainty.push('reputation_unavailable')

  const engagementTier = deriveEngagementTier(waiverActivity.tier, tradeActivity.tier, lineupActivity.tier)
  const inactivityWarnings = buildInactivityWarnings(participation, completeness, commWorkload)
  const engagementWarnings = buildEngagementWarnings(waiverActivity, tradeActivity, lineupActivity)

  const freshness: LeagueIntelFreshness = {
    computedAt: now,
    worldLastSyncedAt: world.provenance.freshness.lastSyncedAt,
    isWorldStale,
  }

  return {
    ...world,
    leagueIntelligence: {
      healthScore,
      managerParticipation: participation,
      rosterCompleteness: completeness,
      waiverActivity,
      tradeActivity,
      lineupActivity,
      engagementTier,
      commissionerWorkload: commWorkload,
      leagueReputation,
      inactivityWarnings,
      engagementWarnings,
      freshness,
      uncertainty,
    },
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Read-only resolvers
// ──────────────────────────────────────────────────────────────────────────

export const defaultLeagueIntelPort: LeagueIntelPort = {
  loadLeagueActivityCounts,
  loadLeagueReputation,
}

/**
 * Top-level orchestrator: chains F2.1 enrichment → loads activity counts + reputation → projects.
 * NEVER throws. Returns null when the league does not exist.
 */
export async function resolveLeagueIntelEnrichedCanonicalWorld(
  leagueId: string,
  deps?: LeagueIntelEnrichedWorldDeps,
): Promise<LeagueIntelEnrichedCanonicalWorld | null> {
  const now = deps?.now ?? new Date()
  const lookbackDays = deps?.lookbackDays ?? DEFAULT_LOOKBACK_DAYS
  const port = deps?.intel ?? defaultLeagueIntelPort

  const base = await resolveEnrichedCanonicalWorld(leagueId).catch(() => null)
  if (!base) return null

  const since = new Date(now.getTime() - lookbackDays * 24 * 60 * 60 * 1000)

  const [activityResult, reputationResult] = await Promise.all([
    port
      .loadLeagueActivityCounts(leagueId, since, lookbackDays)
      .then((counts) => ({ counts, error: null }))
      .catch((err: unknown) => ({
        counts: null,
        error: err instanceof Error ? err.message : String(err),
      })),
    port
      .loadLeagueReputation(leagueId)
      .then((row) => ({ row, error: null }))
      .catch((err: unknown) => ({
        row: null,
        error: err instanceof Error ? err.message : String(err),
      })),
  ])

  return projectLeagueIntelEnrichedWorld(base, activityResult, reputationResult, now)
}

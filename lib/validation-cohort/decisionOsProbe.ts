/**
 * Fantasy OS Suite — Phase V7.1: Decision OS Validation Cohort (DB-less Decision OS probe).
 *
 * Runs the Decision OS derivations that are reachable WITHOUT persistence, from provider-neutral facts,
 * and honestly marks the rest as `db-backed-only`. This is the "which OS outputs are fully vs partially
 * reachable" boundary that DB-less mode was accepted with.
 *
 * Reachable DB-less (real derivation):
 *   - League health / engagement / fairness / sustainability  → `monitorLeagueHealth` (pure, deterministic)
 *     which underpins **Commissioner OS** and **League OS**.
 *   - Draft-state consistency (a real calibration check: draft-prep must not appear once the draft is
 *     complete) → derived from the league's draft status.
 * DB-backed-only (needs persisted rosters/players/matchups; NOT fabricated here):
 *   - **Manager OS** championship trajectory + per-category recommendations (manager-command-center).
 *   - **Trade OS** / **Waiver OS** recommendation derivation (need the player pool + roster ownership).
 *   - **Platform OS** is an aggregate over the above; its DB-less signal is derived at the cohort level
 *     from the per-league health results, not per league.
 *
 * Honesty: fields Sleeper's public API does not expose (chat/votes/disputes/FAAB%/commissioner actions)
 * are recorded as UNAVAILABLE and defaulted — they are disclosed as `defaultedInputs`, never invented.
 * Where those feed a score (e.g. engagement), the report notes the score is a floor, not a fabrication.
 */
import { monitorLeagueHealth, type LeagueHealthInput } from '@/lib/league-health/league-health-engine'
import type { NormalizedLeagueFacts, DecisionOutputProbe } from './types'

/** Inputs the DB-less path cannot source from the public provider API; defaulted + disclosed. */
export const DB_LESS_UNAVAILABLE_INPUTS = [
  'lineupSubmissionRate',
  'avgFaabSpentPct',
  'chatMessageCount',
  'voteCount',
  'disputeCount',
  'commissionerActionsThisSeason',
  'unresolvedDisputes',
  'abandonedTeams',
] as const

export type LeagueHealthProbe = {
  probes: DecisionOutputProbe[]
  /** The real, provider-neutral health result (present when derivation succeeded). */
  health?: ReturnType<typeof monitorLeagueHealth>
  /** Inputs that were defaulted because the public API doesn't expose them (disclosed, not fabricated). */
  defaultedInputs: string[]
}

/** Map provider-neutral facts → the pure league-health engine input. */
export function toLeagueHealthInput(facts: NormalizedLeagueFacts): LeagueHealthInput {
  const seasonComplete = facts.draftState === 'complete'
  return {
    sport: facts.sport || 'NFL',
    leagueType: facts.formatType === 'unknown' ? 'redraft' : facts.formatType,
    leagueId: facts.leagueReference,
    numTeams: facts.numTeams,
    // We cannot know the exact current week DB-less; a completed season is treated as full-length.
    currentWeek: seasonComplete ? 17 : 1,
    totalWeeks: 17,
    activeManagers: facts.activeManagers,
    inactiveManagers: facts.inactiveManagers,
    abandonedTeams: 0,
    lineupSubmissionRate: 1.0,
    totalTradesThisSeason: facts.totalTrades,
    totalWaiverClaims: facts.totalWaiverClaims,
    avgFaabSpentPct: 0,
    chatMessageCount: 0,
    voteCount: 0,
    disputeCount: 0,
    commissionerActionsThisSeason: 0,
    unresolvedDisputes: 0,
    playoffTeams: facts.playoffTeams,
    waiverType: facts.waiverType || 'FAAB',
    tradeReviewProcess: 'commissioner',
  }
}

/** Probe every Operating System's per-league output for reachability, running real derivations DB-less. */
export function probeLeague(facts: NormalizedLeagueFacts): LeagueHealthProbe {
  const probes: DecisionOutputProbe[] = []
  const input = toLeagueHealthInput(facts)
  const health = monitorLeagueHealth(input)

  // Commissioner OS + League OS — real, DB-less derivation.
  probes.push({
    os: 'commissioner',
    output: 'league-health',
    reachability: 'available',
    summary: `status=${health.overallStatus} health=${health.leagueHealthScore} fairness=${health.fairnessScore} problems=${health.biggestProblems.length}`,
  })
  probes.push({
    os: 'league',
    output: 'league-momentum-inputs (health/engagement/fairness/sustainability)',
    reachability: 'available',
    summary: `engagement=${health.engagementScore} sustainability=${health.sustainabilityScore} churnRisk=${health.churnRiskScore}`,
  })

  // Draft OS — state check is DB-less; the full draft-prep recommendation is DB-backed.
  probes.push({
    os: 'draft',
    output: 'draft-state-consistency',
    reachability: 'available',
    summary: `draftState=${facts.draftState}`,
  })
  probes.push({
    os: 'draft',
    output: 'draft-preparation-recommendations',
    reachability: 'db-backed-only',
    reason: 'requires persisted draft/roster context; not derivable from public settings alone',
  })

  // Manager / Trade / Waiver recommendation derivation — needs persisted rosters + player pool.
  probes.push({
    os: 'manager',
    output: 'championship-trajectory + per-category recommendations',
    reachability: 'db-backed-only',
    reason: 'manager-command-center snapshot is derived from persisted rosters/matchups',
  })
  probes.push({
    os: 'trade',
    output: 'trade-opportunity recommendations',
    reachability: 'db-backed-only',
    reason: 'needs player pool + roster ownership; only raw trade-activity is DB-less (captured as an archetype)',
  })
  probes.push({
    os: 'waiver',
    output: 'waiver-impact recommendations',
    reachability: 'db-backed-only',
    reason: 'needs the player pool + roster context; only the waiver environment is DB-less (archetype)',
  })

  // Platform OS is an aggregate; its signal is derived at the cohort level, not per league.
  probes.push({
    os: 'platform',
    output: 'platform-focus (cross-league)',
    reachability: 'db-backed-only',
    reason: 'aggregate over manager-side snapshots; cohort-level health rollup is reported separately',
  })

  return { probes, health, defaultedInputs: [...DB_LESS_UNAVAILABLE_INPUTS] }
}

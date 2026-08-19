/**
 * Fantasy OS Suite — Phase V7.1: Decision OS Validation Cohort (archetype classifier).
 *
 * Pure, deterministic classification of a league from PROVIDER-NEUTRAL facts. Every tag carries the
 * exact source field / rule that produced it (Step 4 requirement: "cite the source field or
 * deterministic rule"). No inference from team names; no undefined "competitive"/"casual" labels.
 *
 * Activity thresholds are transparent, documented constants — not learned or fabricated scores.
 */
import type { NormalizedLeagueFacts, ArchetypeTag } from './types'

/** Per-team activity thresholds (transactions / trades per team over the season). Documented + testable. */
export const ACTIVITY_THRESHOLDS = {
  // transactions per team across the season
  txPerTeamLow: 3,
  txPerTeamHigh: 10,
  // trades per team across the season
  tradesPerTeamLow: 0.25,
  tradesPerTeamHigh: 1.0,
  // waiver claims per team across the season
  waiversPerTeamActive: 2,
} as const

function sizeBucket(numTeams: number): string {
  if (numTeams <= 8) return 'small'
  if (numTeams >= 14) return 'large'
  return 'standard'
}

function band(perTeam: number, low: number, high: number): 'low' | 'normal' | 'high' {
  if (perTeam < low) return 'low'
  if (perTeam > high) return 'high'
  return 'normal'
}

/** Classify a league into archetype tags, each with deterministic evidence. */
export function classifyArchetypes(facts: NormalizedLeagueFacts): ArchetypeTag[] {
  const tags: ArchetypeTag[] = []
  const teams = Math.max(1, facts.numTeams)

  tags.push({
    dimension: 'format',
    value: facts.formatType,
    evidence: `league settings.type → ${facts.formatType}`,
  })

  tags.push({
    dimension: 'qb',
    value: facts.hasSuperflex ? 'superflex' : '1qb',
    evidence: facts.hasSuperflex
      ? 'roster_positions includes a SUPER_FLEX slot'
      : 'roster_positions has no SUPER_FLEX slot',
  })

  tags.push({
    dimension: 'tep',
    value: facts.tightEndPremium ? 'tep-on' : 'tep-off',
    evidence: facts.tightEndPremium
      ? 'scoring_settings grants a TE reception premium (bonus_rec_te > 0)'
      : 'no TE reception premium in scoring_settings',
  })

  tags.push({
    dimension: 'idp',
    value: facts.hasIdp ? 'idp-on' : 'idp-off',
    evidence: facts.hasIdp
      ? 'roster_positions includes IDP slots (DL/LB/DB/IDP_FLEX)'
      : 'no IDP slots in roster_positions',
  })

  tags.push({
    dimension: 'size',
    value: sizeBucket(facts.numTeams),
    evidence: `num_teams = ${facts.numTeams} (small ≤8, standard 9–13, large ≥14)`,
  })

  tags.push({
    dimension: 'source-role',
    value: facts.sourceIsCommissioner ? 'commissioner-source' : 'member-source',
    evidence: facts.sourceIsCommissioner
      ? 'cohort account owns/commissions this league'
      : 'cohort account is a non-commissioner member',
  })

  const txPerTeam = facts.totalTransactions / teams
  tags.push({
    dimension: 'transaction-activity',
    value: band(txPerTeam, ACTIVITY_THRESHOLDS.txPerTeamLow, ACTIVITY_THRESHOLDS.txPerTeamHigh),
    evidence: `${facts.totalTransactions} transactions / ${teams} teams = ${txPerTeam.toFixed(2)}/team (low <${ACTIVITY_THRESHOLDS.txPerTeamLow}, high >${ACTIVITY_THRESHOLDS.txPerTeamHigh})`,
  })

  const tradesPerTeam = facts.totalTrades / teams
  tags.push({
    dimension: 'trade-activity',
    value: band(tradesPerTeam, ACTIVITY_THRESHOLDS.tradesPerTeamLow, ACTIVITY_THRESHOLDS.tradesPerTeamHigh),
    evidence: `${facts.totalTrades} trades / ${teams} teams = ${tradesPerTeam.toFixed(2)}/team (low <${ACTIVITY_THRESHOLDS.tradesPerTeamLow}, high >${ACTIVITY_THRESHOLDS.tradesPerTeamHigh})`,
  })

  const waiversPerTeam = facts.totalWaiverClaims / teams
  tags.push({
    dimension: 'waiver-environment',
    value: waiversPerTeam >= ACTIVITY_THRESHOLDS.waiversPerTeamActive ? 'active' : 'quiet',
    evidence: `${facts.totalWaiverClaims} waiver claims / ${teams} teams = ${waiversPerTeam.toFixed(2)}/team (active ≥${ACTIVITY_THRESHOLDS.waiversPerTeamActive})`,
  })

  tags.push({
    dimension: 'draft-state',
    value: facts.draftState,
    evidence: `draft status → ${facts.draftState}`,
  })

  return tags
}

/**
 * AI League Health Monitor Engine
 *
 * Continuous league stability monitoring: activity health, engagement,
 * fairness, sustainability, churn risk, abandonment risk. Always-on
 * early warning system for commissioners.
 *
 * Pure deterministic. <10ms.
 */

import { z } from 'zod'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type OverallStatus = 'excellent' | 'healthy' | 'watch' | 'at_risk' | 'critical'
export type HealthTrend = 'improving' | 'stable' | 'declining'

export const LeagueHealthInputSchema = z.object({
  sport: z.string().default('NFL'),
  leagueType: z.string().default('dynasty'),
  leagueId: z.string(),
  numTeams: z.number().default(12),
  currentWeek: z.number().default(1),
  totalWeeks: z.number().default(17),
  // Activity metrics
  activeManagers: z.number().default(12),
  inactiveManagers: z.number().default(0),
  abandonedTeams: z.number().default(0),
  lineupSubmissionRate: z.number().default(1.0), // 0-1
  // Transaction metrics
  totalTradesThisSeason: z.number().default(0),
  totalWaiverClaims: z.number().default(0),
  avgFaabSpentPct: z.number().default(0), // 0-100
  // Engagement metrics
  chatMessageCount: z.number().default(0),
  voteCount: z.number().default(0),
  disputeCount: z.number().default(0),
  // Commissioner metrics
  commissionerActionsThisSeason: z.number().default(0),
  unresolvedDisputes: z.number().default(0),
  // Settings quality
  playoffTeams: z.number().default(6),
  waiverType: z.string().default('FAAB'),
  tradeReviewProcess: z.string().default('commissioner'),
  // History
  previousSeasonHealthScore: z.number().optional(),
})
export type LeagueHealthInput = z.infer<typeof LeagueHealthInputSchema>

export interface LeagueHealthResult {
  leagueHealthScore: number
  /**
   * 🛑 THIS IS ACTIVITY, NOT PARTICIPATION, AND THREE MODULES DISAGREE ABOUT THE WORD (6.1).
   *
   * Computed by `computeEngagement` below from transaction volume, chat and lineup submission:
   *
   *     base 30 + min(20, trades/team × 6) + min(20, claims/team × 2.5)
   *             + min(15, chat × 0.3) + 15 (lineup ≥ 0.95) or 8 (≥ 0.8)
   *
   * ⚠ ITS FLOOR IS 30, NOT 0. Every term is non-negative and the base is unconditional, so this
   * number CANNOT report that a league is dead. It also never reads `input.activeManagers` —
   * which the schema declares and, measured, **nothing in this file reads at all**.
   *
   * That is not the defect it looks like: `computeSustainability` subtracts 10 per inactive
   * manager, so a dormant league scores 0 there and fires `sustainability_low` plus
   * `league_health_critical`. The league IS flagged. This number simply is not the thing doing it.
   *
   * ⚠ DO NOT COMPARE IT WITH `leagueEngagementScore` from
   * `lib/decision-os/behavioral/league-intelligence.ts`. Same name, same 0–100 scale, different
   * question — that one measures active-manager share and per-manager depth, floors at 0, and on
   * a dormant league reads 0 where this reads 30. Measured spread of 40 points; 2 points on a
   * healthy league. `scripts/probe-league-health-scorer-divergence.ts` reproduces it.
   */
  engagementScore: number
  fairnessScore: number
  sustainabilityScore: number
  confidencePct: number
  overallStatus: OverallStatus
  biggestStrengths: string[]
  biggestProblems: string[]
  urgentAlerts: string[]
  earlyWarningSignals: string[]
  inactiveManagerNotes: string[]
  transactionHealthNotes: string[]
  waiverHealthNotes: string[]
  tradeHealthNotes: string[]
  rosterBalanceNotes: string[]
  commissionerHealthNotes: string[]
  interventionRecommendations: string[]
  summary: string
  generatedAt: string
  healthTrend: HealthTrend
  churnRiskScore: number
  disputeRiskScore: number
  abandonmentRiskScore: number
  engagementDropoffFlags: string[]
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

function clamp(v: number, lo: number, hi: number): number { return Math.max(lo, Math.min(hi, v)) }

function computeEngagement(input: LeagueHealthInput): number {
  let score = 30
  const tradesPerTeam = input.totalTradesThisSeason / Math.max(input.numTeams, 1)
  const claimsPerTeam = input.totalWaiverClaims / Math.max(input.numTeams, 1)
  score += Math.min(20, tradesPerTeam * 6)
  score += Math.min(20, claimsPerTeam * 2.5)
  score += Math.min(15, input.chatMessageCount * 0.3)
  if (input.lineupSubmissionRate >= 0.95) score += 15
  else if (input.lineupSubmissionRate >= 0.8) score += 8
  return clamp(Math.round(score), 0, 100)
}

function computeFairness(input: LeagueHealthInput): number {
  let score = 65
  if (input.waiverType === 'FAAB') score += 10
  if (input.tradeReviewProcess !== 'none') score += 10
  if (input.abandonedTeams === 0) score += 10
  else score -= input.abandonedTeams * 12
  if (input.disputeCount === 0) score += 5
  else score -= input.disputeCount * 5
  return clamp(Math.round(score), 0, 100)
}

function computeSustainability(input: LeagueHealthInput): number {
  let score = 50
  if (input.inactiveManagers === 0) score += 20
  else score -= input.inactiveManagers * 10
  if (input.abandonedTeams === 0) score += 15
  else score -= input.abandonedTeams * 15
  if (input.lineupSubmissionRate >= 0.9) score += 15
  if (input.unresolvedDisputes === 0) score += 5
  else score -= input.unresolvedDisputes * 8
  if (input.leagueType === 'dynasty' && input.totalTradesThisSeason >= input.numTeams) score += 10
  return clamp(Math.round(score), 0, 100)
}

function computeOverallHealth(engagement: number, fairness: number, sustainability: number): number {
  return Math.round(engagement * 0.35 + fairness * 0.30 + sustainability * 0.35)
}

function classifyStatus(health: number): OverallStatus {
  if (health >= 80) return 'excellent'
  if (health >= 65) return 'healthy'
  if (health >= 50) return 'watch'
  if (health >= 35) return 'at_risk'
  return 'critical'
}

// ---------------------------------------------------------------------------
// Main Entry Point
// ---------------------------------------------------------------------------

export function monitorLeagueHealth(input: LeagueHealthInput): LeagueHealthResult {
  const engagement = computeEngagement(input)
  const fairness = computeFairness(input)
  const sustainability = computeSustainability(input)
  const health = computeOverallHealth(engagement, fairness, sustainability)
  const status = classifyStatus(health)

  const strengths: string[] = []
  if (engagement >= 70) strengths.push('Strong engagement — active trading and waiver use')
  if (fairness >= 80) strengths.push('Fair structure — good settings and low disputes')
  if (sustainability >= 70) strengths.push('Sustainable — all managers active, no abandonment')
  if (input.lineupSubmissionRate >= 0.95) strengths.push('Near-perfect lineup submission rate')
  if (input.chatMessageCount >= 20) strengths.push('Active league chat — strong community')

  const problems: string[] = []
  if (input.inactiveManagers >= 2) problems.push(`${input.inactiveManagers} inactive managers — engagement at risk`)
  if (input.abandonedTeams > 0) problems.push(`${input.abandonedTeams} abandoned teams — immediate action needed`)
  if (input.unresolvedDisputes > 0) problems.push(`${input.unresolvedDisputes} unresolved disputes eroding trust`)
  if (engagement < 40) problems.push('Low engagement — league activity is below healthy levels')
  if (input.lineupSubmissionRate < 0.7) problems.push('Poor lineup submission rate — managers are checked out')

  const urgentAlerts: string[] = []
  if (input.abandonedTeams >= 2) urgentAlerts.push('CRITICAL: Multiple abandoned teams. Find replacements immediately.')
  if (input.unresolvedDisputes >= 2) urgentAlerts.push('URGENT: Unresolved disputes accumulating. Commissioner action required.')
  if (input.inactiveManagers >= Math.ceil(input.numTeams * 0.3)) urgentAlerts.push('ALERT: 30%+ of managers inactive. League may be dying.')

  const earlyWarnings: string[] = []
  if (input.lineupSubmissionRate < 0.85 && input.lineupSubmissionRate >= 0.7) earlyWarnings.push('Lineup submission dipping — some managers may be losing interest')
  if (input.totalTradesThisSeason === 0 && input.currentWeek >= 4) earlyWarnings.push('Zero trades through week ' + input.currentWeek + ' — trade market may be stagnant')
  if (input.chatMessageCount < 5 && input.currentWeek >= 3) earlyWarnings.push('Very low chat activity — community engagement is weak')

  const churnRisk = clamp(Math.round(100 - sustainability), 0, 100)
  const disputeRisk = clamp(Math.round(input.unresolvedDisputes * 25 + input.disputeCount * 10), 0, 100)
  const abandonmentRisk = clamp(Math.round(input.abandonedTeams * 30 + input.inactiveManagers * 15), 0, 100)

  const healthTrend: HealthTrend = input.previousSeasonHealthScore != null
    ? health > input.previousSeasonHealthScore + 5 ? 'improving' : health < input.previousSeasonHealthScore - 5 ? 'declining' : 'stable'
    : 'stable'

  const interventions: string[] = []
  if (input.abandonedTeams > 0) interventions.push('Find replacement managers for abandoned teams')
  if (input.unresolvedDisputes > 0) interventions.push('Resolve all pending disputes this week')
  if (engagement < 50) interventions.push('Post weekly recaps, power rankings, or trash talk threads to boost engagement')
  if (input.totalTradesThisSeason < input.numTeams / 2 && input.currentWeek >= 4) interventions.push('Consider extending trade deadline or brokering deals to stimulate trade activity')

  const confidence = clamp(40 + (input.currentWeek >= 3 ? 15 : 0) + (input.numTeams >= 8 ? 15 : 0) + (problems.length > 0 || strengths.length > 0 ? 10 : 0), 25, 90)

  return {
    leagueHealthScore: health, engagementScore: engagement, fairnessScore: fairness,
    sustainabilityScore: sustainability, confidencePct: confidence, overallStatus: status,
    biggestStrengths: strengths.slice(0, 4), biggestProblems: problems.slice(0, 4),
    urgentAlerts, earlyWarningSignals: earlyWarnings,
    inactiveManagerNotes: input.inactiveManagers > 0 ? [`${input.inactiveManagers} manager(s) showing inactivity — reach out before it becomes abandonment`] : [],
    transactionHealthNotes: [], waiverHealthNotes: [], tradeHealthNotes: [],
    rosterBalanceNotes: [], commissionerHealthNotes: input.commissionerActionsThisSeason === 0 ? ['Commissioner has taken no actions this season — consider posting updates'] : [],
    interventionRecommendations: interventions,
    summary: `League health: ${health}/100 (${status}). ${strengths[0] ?? 'No major strengths.'} ${problems[0] ? `Problem: ${problems[0]}` : 'No major problems.'}`,
    generatedAt: new Date().toISOString(),
    healthTrend, churnRiskScore: churnRisk, disputeRiskScore: disputeRisk,
    abandonmentRiskScore: abandonmentRisk,
    engagementDropoffFlags: input.lineupSubmissionRate < 0.8 ? ['Lineup submission below 80% — managers losing interest'] : [],
  }
}

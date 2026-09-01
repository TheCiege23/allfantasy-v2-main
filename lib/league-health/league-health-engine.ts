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

// The single activity formula, shared with commissioner-assistant-engine (6.1).
import { computeActivityScore } from './activityScore'

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
   * Computed by `computeActivityScore` — ONE formula, shared with `commissioner-assistant-engine`
   * since 6.1, because that module carried a second copy with different constants that disagreed
   * with this one by 10 points on an empty league. This caller supplies every term, so its numbers
   * are byte-identical to the private version it replaced.
   *
   * ⚠ ITS FLOOR WAS 30 UNTIL 6.1 AND IS NOW 0. The base used to be granted unconditionally, so a
   * league where nothing had happened and nobody was left still scored 30/100. It is now scaled by
   * `activeManagers / numTeams` — a field the schema had always declared and this file read
   * NOWHERE. A fully-staffed league is unaffected; the change bites only as managers leave.
   *
   * ⚠ A DEAD LEAGUE WAS NEVER UNFLAGGED, THOUGH. `computeSustainability` subtracts 10 per
   * inactive manager, so a dormant league has always scored 0 there and fired `sustainability_low`
   * plus `league_health_critical`. The fix was to a number that was false, not to a missing alarm.
   *
   * ⚠ IT IS STILL A DIFFERENT QUESTION from `leagueEngagementScore` in
   * `lib/decision-os/behavioral/league-intelligence.ts` — throughput versus people. Since 6.1 all
   * three scores agree at 0 on a dormant league, which is the gap that mattered, but they still
   * diverge on a league that is fully staffed and silent, or half-empty and busy. Agreement on the
   * worst case is not interchangeability.
   * `scripts/probe-league-health-scorer-divergence.ts` reproduces all three.
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

/**
 * 🛑 THE BASE IS EARNED BY PARTICIPATION, NOT GRANTED (6.1 / §2.23).
 *
 * It used to be an unconditional `30`, so a league where literally nothing had happened and
 * nobody was left scored 30/100 — a third healthy, which is not approximate but false. Every
 * other term is non-negative, so 30 was a floor no input could get below.
 *
 * ⚠ AND THE FIELD THAT FIXES IT WAS ALREADY HERE AND UNREAD. `activeManagers` is declared by
 * `LeagueHealthInputSchema` and was referenced NOWHERE in this file — measured, zero occurrences.
 * `commissionerHubHealth` has always passed it: `teamCount - inactiveTeams`, where inactive means
 * a roster untouched for `INACTIVE_AFTER_MS` (14 days). So this needs no new data.
 *
 * ⚠ A FULLY-STAFFED LEAGUE IS BYTE-IDENTICAL TO BEFORE. `activeShare === 1` gives back exactly
 * the old base of 30, which is what keeps this off the nine dashboards that read this number.
 * The change only bites as managers actually leave, which is when it should.
 *
 * ⚠ ONLY THE BASE SCALES, DELIBERATELY. Scaling the whole score would re-weight the formula and
 * dock a league 8% for one inactive manager out of twelve. The defect being fixed is the FLOOR,
 * and a league with real transaction volume genuinely has activity worth counting.
 *
 * ⚠ THIS STILL MEASURES ACTIVITY, NOT PARTICIPATION. A league that was busy and has since died
 * keeps credit for the season's trades — correctly, that is a different situation from one that
 * never started, and `computeSustainability` scores it 0 either way. See the note on
 * `LeagueHealthResult.engagementScore`.
 */
function computeEngagement(input: LeagueHealthInput): number {
  /*
   * ⚠ DELEGATES SINCE 6.1. The formula moved to `lib/league-health/activityScore.ts` because
   * `commissioner-assistant-engine` carried a second copy with different constants that disagreed
   * with this one on an empty league. This caller supplies EVERY term, so the normalisation there
   * divides by the full 100 and the numbers are byte-identical to before — which is what keeps
   * this off the nine dashboards that read it.
   */
  return computeActivityScore({
    activeManagers: input.activeManagers,
    numTeams: input.numTeams,
    totalTrades: input.totalTradesThisSeason,
    totalWaiverClaims: input.totalWaiverClaims,
    chatMessageCount: input.chatMessageCount,
    lineupSubmissionRate: input.lineupSubmissionRate,
  })
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

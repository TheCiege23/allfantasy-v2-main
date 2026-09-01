/**
 * AI Commissioner Assistant Engine
 *
 * League operations AI: settings analysis, health scoring, dispute guidance,
 * engagement recommendations, and concept-league support.
 *
 * Pure deterministic. <15ms.
 */

import { z } from 'zod'

// The single activity formula, shared with league-health-engine (6.1).
import { computeActivityScore } from '@/lib/league-health/activityScore'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SettingChange {
  area: string
  currentIssue: string
  suggestedChange: string
  expectedBenefit: string
  urgency: 'low' | 'medium' | 'high'
}

export const CommissionerInputSchema = z.object({
  sport: z.string().default('NFL'),
  leagueType: z.string().default('dynasty'),
  leagueFormat: z.string().optional(),
  numTeams: z.number().default(12),
  scoringFormat: z.string().default('PPR'),
  rosterSlots: z.number().default(25),
  benchSlots: z.number().default(10),
  irSlots: z.number().default(2),
  taxiSlots: z.number().default(0),
  playoffTeams: z.number().default(6),
  playoffWeeks: z.number().default(3),
  waiverType: z.string().default('FAAB'),
  tradeDeadline: z.string().nullable().default(null),
  tradeReviewProcess: z.enum(['commissioner', 'league_vote', 'none']).default('commissioner'),
  vetoThreshold: z.number().optional(),
  totalTradesThisSeason: z.number().default(0),
  totalWaiverClaims: z.number().default(0),
  inactiveManagers: z.number().default(0),
  disputeCount: z.number().default(0),
  abandonedTeams: z.number().default(0),
  isConceptLeague: z.boolean().default(false),
  conceptType: z.string().optional(),
  commissionerQuestion: z.string().optional(),
})
export type CommissionerInput = z.infer<typeof CommissionerInputSchema>

export interface CommissionerResult {
  leagueHealthScore: number
  /**
   * ⚠ A THIRD FORMULA UNDER THE SAME NAME, unrelated to the other two (6.1).
   *
   *     base 40 + min(25, trades/team × 8) + min(25, claims/team × 3) + 10 if none inactive
   *
   * Floors at 40, so like the league-health engine's it cannot report a dead league — and unlike
   * it, this one has no chat or lineup input at all. Do not compare either with
   * `leagueEngagementScore` in `lib/decision-os/behavioral/league-intelligence.ts`, which measures
   * participation and floors at 0.
   *
   * This lineage is ISOLATED — one consumer, `app/api/commissioner-assistant/route.ts` — and,
   * measured, it never appears in the same file as the commissioner-hub lineage. That is why it
   * was left out of any rename: nothing here can be confused with anything at a call site.
   */
  engagementScore: number
  fairnessScore: number
  confidencePct: number
  topStrengths: string[]
  topProblems: string[]
  urgentFixes: string[]
  recommendedSettingChanges: SettingChange[]
  disputeGuidance: string[]
  suspiciousActivityNotes: string[]
  inactiveManagerWarnings: string[]
  playoffStructureNotes: string[]
  waiverStructureNotes: string[]
  tradeReviewNotes: string[]
  payoutNotes: string[]
  engagementRecommendations: string[]
  commissionerActionPlan: string[]
  summary: string
  generatedAt: string
}

// ---------------------------------------------------------------------------
// Health Scoring
// ---------------------------------------------------------------------------

function computeLeagueHealth(input: CommissionerInput): number {
  let score = 60
  if (input.inactiveManagers === 0) score += 15
  else score -= input.inactiveManagers * 8
  if (input.abandonedTeams === 0) score += 10
  else score -= input.abandonedTeams * 12
  if (input.disputeCount === 0) score += 5
  else score -= input.disputeCount * 5
  if (input.totalTradesThisSeason >= input.numTeams) score += 10
  return Math.max(0, Math.min(100, Math.round(score)))
}

function computeEngagement(input: CommissionerInput): number {
  /*
   * ⚠ DELEGATES SINCE 6.1 — this was the SECOND copy of the activity formula, with its own
   * constants and its own base of 40, and it disagreed with league-health's by 10 points on an
   * empty league. Both now call `computeActivityScore`.
   *
   * 🛑 CHAT AND LINEUP ARE PASSED AS `null`, NOT 0. This input type has neither field, and
   * scoring an unavailable term as zero would cap this route at 70 for inputs that used to reach
   * 100 — against its own `>= 60` "good engagement" threshold, a silent regression. `null` drops
   * those weights from the denominator instead, so the range stays 0–100 over the terms that
   * exist here.
   *
   * ⚠ The base is now earned by participation, so a league where everyone has left scores 0
   * where it used to score 40. `activeManagers` is derived — this type carries only its
   * complement.
   */
  return computeActivityScore({
    activeManagers: Math.max(0, input.numTeams - input.inactiveManagers),
    numTeams: input.numTeams,
    totalTrades: input.totalTradesThisSeason,
    totalWaiverClaims: input.totalWaiverClaims,
    chatMessageCount: null,
    lineupSubmissionRate: null,
  })
}

function computeFairness(input: CommissionerInput): number {
  let score = 70
  if (input.tradeReviewProcess === 'none') score -= 10
  if (input.waiverType === 'FAAB') score += 10
  if (input.playoffTeams >= Math.ceil(input.numTeams * 0.4) && input.playoffTeams <= Math.ceil(input.numTeams * 0.6)) score += 10
  if (input.abandonedTeams > 0) score -= 15
  if (input.vetoThreshold != null && input.vetoThreshold < 3) score -= 5
  return Math.max(0, Math.min(100, Math.round(score)))
}

// ---------------------------------------------------------------------------
// Setting Analysis
// ---------------------------------------------------------------------------

function analyzeSettings(input: CommissionerInput): SettingChange[] {
  const changes: SettingChange[] = []

  if (input.playoffTeams > Math.ceil(input.numTeams * 0.6)) {
    changes.push({
      area: 'Playoffs', currentIssue: `${input.playoffTeams} playoff teams in a ${input.numTeams}-team league — too many`,
      suggestedChange: `Reduce to ${Math.ceil(input.numTeams * 0.5)} playoff teams`,
      expectedBenefit: 'More meaningful regular season and higher stakes for playoff spots',
      urgency: 'medium',
    })
  }

  if (input.playoffTeams < Math.ceil(input.numTeams * 0.25)) {
    changes.push({
      area: 'Playoffs', currentIssue: `Only ${input.playoffTeams} playoff spots — too few for engagement`,
      suggestedChange: `Increase to ${Math.ceil(input.numTeams * 0.4)} playoff teams`,
      expectedBenefit: 'More managers stay engaged through the season',
      urgency: 'medium',
    })
  }

  if (input.waiverType !== 'FAAB' && input.leagueType === 'dynasty') {
    changes.push({
      area: 'Waivers', currentIssue: `Using ${input.waiverType} waivers in a dynasty league`,
      suggestedChange: 'Switch to FAAB — more strategic and fair for dynasty',
      expectedBenefit: 'Every manager has equal chance to acquire waiver targets',
      urgency: 'high',
    })
  }

  if (input.tradeReviewProcess === 'none' && input.numTeams >= 10) {
    changes.push({
      area: 'Trade Review', currentIssue: 'No trade review process in a 10+ team league',
      suggestedChange: 'Add commissioner review or league vote for trades',
      expectedBenefit: 'Prevents collusion and maintains competitive integrity',
      urgency: 'high',
    })
  }

  if (input.benchSlots > 15 && input.leagueType !== 'dynasty') {
    changes.push({
      area: 'Roster Size', currentIssue: `${input.benchSlots} bench slots — excessive for ${input.leagueType}`,
      suggestedChange: `Reduce to ${input.leagueType === 'dynasty' ? 12 : 6} bench slots`,
      expectedBenefit: 'Better waiver wire activity and more strategic roster decisions',
      urgency: 'low',
    })
  }

  if (input.taxiSlots === 0 && input.leagueType === 'dynasty') {
    changes.push({
      area: 'Taxi Squad', currentIssue: 'No taxi squad in dynasty league',
      suggestedChange: 'Add 3-5 taxi slots for rookie development',
      expectedBenefit: 'Encourages patient dynasty building and rewards drafting well',
      urgency: 'low',
    })
  }

  return changes
}

// ---------------------------------------------------------------------------
// Warnings & Guidance
// ---------------------------------------------------------------------------

function buildInactiveWarnings(input: CommissionerInput): string[] {
  const warnings: string[] = []
  if (input.inactiveManagers >= 3) warnings.push(`${input.inactiveManagers} inactive managers — league health is critical. Consider replacement managers.`)
  else if (input.inactiveManagers >= 1) warnings.push(`${input.inactiveManagers} inactive manager${input.inactiveManagers > 1 ? 's' : ''} — monitor and reach out.`)
  if (input.abandonedTeams > 0) warnings.push(`${input.abandonedTeams} abandoned team${input.abandonedTeams > 1 ? 's' : ''} — find replacement owners or consider dispersal draft.`)
  return warnings
}

function buildDisputeGuidance(input: CommissionerInput): string[] {
  const guidance: string[] = []
  if (input.disputeCount > 0) {
    guidance.push(`${input.disputeCount} dispute${input.disputeCount > 1 ? 's' : ''} recorded. Address promptly — unresolved disputes erode league trust.`)
    guidance.push('For trade disputes: distinguish "unfair" from "unpopular." Only reverse trades for clear collusion, not bad judgment.')
  }
  if (input.tradeReviewProcess === 'league_vote' && input.vetoThreshold != null && input.vetoThreshold < 4) {
    guidance.push(`Veto threshold of ${input.vetoThreshold} is too low — consider raising to prevent spite vetoes.`)
  }
  return guidance
}

function buildEngagementRecs(input: CommissionerInput): string[] {
  const recs: string[] = []
  const engagement = computeEngagement(input)
  if (engagement < 40) {
    recs.push('Low engagement — consider weekly recap posts, power rankings, or trash talk threads')
    recs.push('Run a mid-season contest (best team name, boldest prediction, etc.) to boost activity')
  }
  if (input.totalTradesThisSeason < input.numTeams / 2) {
    recs.push('Trade activity is low — consider a trade deadline extension or commissioner-brokered deals')
  }
  if (input.totalWaiverClaims < input.numTeams * 2) {
    recs.push('Waiver activity is low — ensure FAAB budgets are set and remind managers of available players')
  }
  return recs.slice(0, 4)
}

// ---------------------------------------------------------------------------
// Main Entry Point
// ---------------------------------------------------------------------------

export function analyzeCommissionerDashboard(input: CommissionerInput): CommissionerResult {
  const healthScore = computeLeagueHealth(input)
  const engagementScore = computeEngagement(input)
  const fairnessScore = computeFairness(input)
  const settingChanges = analyzeSettings(input)
  const inactiveWarnings = buildInactiveWarnings(input)
  const disputeGuidance = buildDisputeGuidance(input)
  const engagementRecs = buildEngagementRecs(input)

  const topStrengths: string[] = []
  if (healthScore >= 70) topStrengths.push('Healthy league — low inactivity and disputes')
  if (engagementScore >= 60) topStrengths.push('Good engagement — active trading and waiver activity')
  if (fairnessScore >= 80) topStrengths.push('Fair structure — settings support competitive balance')
  if (input.waiverType === 'FAAB') topStrengths.push('FAAB waivers — strategic and equitable')

  const topProblems: string[] = []
  if (input.inactiveManagers >= 2) topProblems.push(`${input.inactiveManagers} inactive managers threatening league health`)
  if (input.abandonedTeams > 0) topProblems.push(`${input.abandonedTeams} abandoned teams need immediate attention`)
  if (settingChanges.filter(c => c.urgency === 'high').length > 0) topProblems.push('High-urgency setting changes needed')
  if (engagementScore < 40) topProblems.push('Low engagement — league activity is below healthy levels')

  const urgentFixes = settingChanges.filter(c => c.urgency === 'high').map(c => `${c.area}: ${c.suggestedChange}`)
  if (input.abandonedTeams > 0) urgentFixes.unshift('Find replacement managers for abandoned teams')

  const actionPlan: string[] = []
  if (urgentFixes.length > 0) actionPlan.push(`Address ${urgentFixes.length} urgent fix${urgentFixes.length > 1 ? 'es' : ''} immediately`)
  if (settingChanges.length > urgentFixes.length) actionPlan.push(`Review ${settingChanges.length - urgentFixes.length} additional setting recommendations`)
  if (engagementRecs.length > 0) actionPlan.push('Implement engagement recommendations before next week')
  actionPlan.push('Schedule end-of-season review to assess rule changes for next year')

  const confidence = Math.min(85, 40 + (input.numTeams >= 8 ? 15 : 0) + (topStrengths.length * 5) + (topProblems.length > 0 ? 10 : 0))

  return {
    leagueHealthScore: healthScore, engagementScore, fairnessScore, confidencePct: confidence,
    topStrengths, topProblems, urgentFixes,
    recommendedSettingChanges: settingChanges,
    disputeGuidance, suspiciousActivityNotes: [],
    inactiveManagerWarnings: inactiveWarnings,
    playoffStructureNotes: settingChanges.filter(c => c.area === 'Playoffs').map(c => c.currentIssue),
    waiverStructureNotes: settingChanges.filter(c => c.area === 'Waivers').map(c => c.currentIssue),
    tradeReviewNotes: settingChanges.filter(c => c.area === 'Trade Review').map(c => c.currentIssue),
    payoutNotes: [], engagementRecommendations: engagementRecs,
    commissionerActionPlan: actionPlan,
    summary: `League health: ${healthScore}/100 | Engagement: ${engagementScore}/100 | Fairness: ${fairnessScore}/100. ${urgentFixes.length > 0 ? `${urgentFixes.length} urgent fix${urgentFixes.length > 1 ? 'es' : ''} needed.` : 'No urgent issues.'} ${topProblems[0] ?? 'League is in good shape.'}`,
    generatedAt: new Date().toISOString(),
  }
}

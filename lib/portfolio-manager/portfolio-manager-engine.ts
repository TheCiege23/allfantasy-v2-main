/**
 * AI Multi-Sport Portfolio Manager Engine
 *
 * Aggregates all user teams/leagues, evaluates exposure, risk, urgency,
 * and strategic distribution. Prioritizes where action is most needed.
 *
 * Pure deterministic. <15ms.
 */

import { z } from 'zod'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

const PortfolioModeEnum = z.enum([
  'full_overview', 'weekly_priorities', 'exposure_audit', 'dynasty_long_term',
  'devy_pipeline', 'c2c_balance', 'risk_management', 'commissioner_load',
])

interface PortfolioTeam {
  leagueId: string
  leagueName: string
  sport: string
  leagueType: string
  teamName: string
  contenderTier: string
  powerScore: number
  urgencyScore: number
  needsAttention: boolean
  rosterSize: number
  injuredCount: number
  topPlayers: string[]
  needs: string[]
  isCommissioner: boolean
}

export const PortfolioInputSchema = z.object({
  userId: z.string(),
  portfolioMode: PortfolioModeEnum.default('full_overview'),
  teams: z.array(z.object({
    leagueId: z.string(), leagueName: z.string(), sport: z.string(),
    leagueType: z.string().default('dynasty'), teamName: z.string(),
    contenderTier: z.string().default('middle'), powerScore: z.number().default(50),
    urgencyScore: z.number().default(30), needsAttention: z.boolean().default(false),
    rosterSize: z.number().default(15), injuredCount: z.number().default(0),
    topPlayers: z.array(z.string()).default([]),
    needs: z.array(z.string()).default([]),
    isCommissioner: z.boolean().default(false),
  })),
  riskTolerance: z.enum(['conservative', 'moderate', 'aggressive']).default('moderate'),
})
type PortfolioInput = z.infer<typeof PortfolioInputSchema>

interface PortfolioResult {
  portfolioMode: string
  portfolioHealthScore: number
  urgencyScore: number
  confidencePct: number
  overviewSummary: string
  topPriorities: string[]
  immediateActions: string[]
  overexposureFlags: string[]
  undermanagedAreas: string[]
  strongestTeams: string[]
  weakestTeams: string[]
  contenderClusters: string[]
  rebuildClusters: string[]
  injuryRiskClusters: string[]
  playerExposureNotes: string[]
  positionExposureNotes: string[]
  timeAllocationRecommendations: string[]
  summary: string
  generatedAt: string
  sportExposureBreakdown: Array<{ sport: string; teamCount: number; avgPower: number }>
  leaguePriorityRankings: Array<{ leagueId: string; label: string; priorityScore: number }>
  strategicConflictFlags: string[]
  portfolioBalanceTrend: 'improving' | 'stable' | 'drifting' | 'overloaded'
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function clamp(v: number, lo: number, hi: number): number { return Math.max(lo, Math.min(hi, v)) }

// ---------------------------------------------------------------------------
// Main Entry Point
// ---------------------------------------------------------------------------

export function analyzePortfolio(input: PortfolioInput): PortfolioResult {
  const teams = input.teams

  // Sport exposure
  const sportMap = new Map<string, PortfolioTeam[]>()
  for (const t of teams) {
    if (!sportMap.has(t.sport)) sportMap.set(t.sport, [])
    sportMap.get(t.sport)!.push(t)
  }
  const sportBreakdown = [...sportMap.entries()].map(([sport, ts]) => ({
    sport, teamCount: ts.length, avgPower: Math.round(ts.reduce((s, t) => s + t.powerScore, 0) / ts.length),
  }))

  // League priority rankings
  const leaguePriority = teams
    .map(t => ({
      leagueId: t.leagueId,
      label: `${t.leagueName} (${t.sport})`,
      priorityScore: clamp(Math.round(t.urgencyScore + (t.needsAttention ? 20 : 0) + (t.contenderTier === 'contender' ? 15 : 0) + (t.injuredCount * 5)), 0, 100),
    }))
    .sort((a, b) => b.priorityScore - a.priorityScore)

  // Top priorities
  const topPriorities: string[] = []
  const urgent = teams.filter(t => t.needsAttention || t.urgencyScore >= 60)
  for (const t of urgent.slice(0, 3)) {
    topPriorities.push(`${t.leagueName}: ${t.teamName} needs attention (urgency ${t.urgencyScore}/100)`)
  }
  if (topPriorities.length === 0) topPriorities.push('No urgent actions needed across your portfolio')

  // Immediate actions
  const immediateActions: string[] = []
  const injuredTeams = teams.filter(t => t.injuredCount >= 2)
  if (injuredTeams.length > 0) immediateActions.push(`Check lineups: ${injuredTeams.map(t => t.leagueName).join(', ')} have injury concerns`)
  const needsTeams = teams.filter(t => t.needs.length >= 2)
  if (needsTeams.length > 0) immediateActions.push(`Address roster holes: ${needsTeams.map(t => t.leagueName).join(', ')} have multiple needs`)

  // Overexposure
  const overexposure: string[] = []
  const playerCounts = new Map<string, number>()
  for (const t of teams) {
    for (const p of t.topPlayers) {
      playerCounts.set(p, (playerCounts.get(p) || 0) + 1)
    }
  }
  for (const [player, count] of playerCounts) {
    if (count >= 3) overexposure.push(`${player} is on ${count} of your teams — high exposure risk`)
  }

  // Strongest / weakest
  const sorted = [...teams].sort((a, b) => b.powerScore - a.powerScore)
  const strongest = sorted.slice(0, 3).map(t => `${t.leagueName}: ${t.teamName} (${t.powerScore}/100)`)
  const weakest = sorted.slice(-3).reverse().map(t => `${t.leagueName}: ${t.teamName} (${t.powerScore}/100)`)

  // Clusters
  const contenders = teams.filter(t => t.contenderTier === 'contender' || t.contenderTier === 'champion')
  const rebuilders = teams.filter(t => t.contenderTier === 'rebuild')
  const injuryRiskTeams = teams.filter(t => t.injuredCount >= 2)

  // Position exposure across all teams
  const positionNeeds = new Map<string, number>()
  for (const t of teams) {
    for (const need of t.needs) {
      positionNeeds.set(need, (positionNeeds.get(need) || 0) + 1)
    }
  }
  const posExposure = [...positionNeeds.entries()]
    .filter(([_, count]) => count >= 2)
    .map(([pos, count]) => `${pos} needed on ${count} teams — portfolio-wide weakness`)

  // Time allocation
  const timeRecs: string[] = []
  if (leaguePriority.length > 0) timeRecs.push(`Focus first on: ${leaguePriority[0].label}`)
  const commLeagues = teams.filter(t => t.isCommissioner)
  if (commLeagues.length >= 2) timeRecs.push(`Commissioner duties in ${commLeagues.length} leagues — schedule admin time`)
  if (teams.length >= 8) timeRecs.push('Large portfolio — consider setting weekly check-in routine per league')

  // Undermaned
  const undermanagedAreas: string[] = []
  const lowPower = teams.filter(t => t.powerScore < 35)
  if (lowPower.length >= 2) undermanagedAreas.push(`${lowPower.length} teams below 35 power score — may need attention`)
  if (teams.filter(t => t.leagueType === 'dynasty').length >= 3) {
    const dynastyAvg = teams.filter(t => t.leagueType === 'dynasty').reduce((s, t) => s + t.powerScore, 0) / teams.filter(t => t.leagueType === 'dynasty').length
    if (dynastyAvg < 45) undermanagedAreas.push('Dynasty portfolio is underperforming on average — review franchise roadmaps')
  }

  // Health and balance
  const avgPower = teams.length > 0 ? teams.reduce((s, t) => s + t.powerScore, 0) / teams.length : 50
  const avgUrgency = teams.length > 0 ? teams.reduce((s, t) => s + t.urgencyScore, 0) / teams.length : 30
  const healthScore = clamp(Math.round(avgPower * 0.6 + (100 - avgUrgency) * 0.4), 0, 100)
  const balanceTrend: PortfolioResult['portfolioBalanceTrend'] =
    overexposure.length >= 3 ? 'overloaded' : healthScore >= 65 ? 'stable' : healthScore >= 45 ? 'drifting' : 'overloaded'

  // Conflicts
  const conflicts: string[] = []
  if (contenders.length >= 3 && rebuilders.length >= 2) conflicts.push('Mix of contending and rebuilding teams — ensure moves in one league don\'t undermine another')
  if (overexposure.length >= 2) conflicts.push('High player overlap creates correlated risk — one injury hurts multiple teams')

  const confidence = clamp(40 + (teams.length >= 3 ? 15 : 0) + (teams.length >= 6 ? 10 : 0) + (overexposure.length > 0 ? 10 : 0), 25, 85)

  return {
    portfolioMode: input.portfolioMode, portfolioHealthScore: healthScore,
    urgencyScore: Math.round(avgUrgency), confidencePct: confidence,
    overviewSummary: `${teams.length} teams across ${sportMap.size} sport${sportMap.size > 1 ? 's' : ''}. Health: ${healthScore}/100. ${contenders.length} contenders, ${rebuilders.length} rebuilders. ${overexposure.length > 0 ? `${overexposure.length} overexposure flags.` : 'No overexposure detected.'}`,
    topPriorities, immediateActions, overexposureFlags: overexposure.slice(0, 5),
    undermanagedAreas, strongestTeams: strongest, weakestTeams: weakest,
    contenderClusters: contenders.map(t => `${t.leagueName}: ${t.teamName}`),
    rebuildClusters: rebuilders.map(t => `${t.leagueName}: ${t.teamName}`),
    injuryRiskClusters: injuryRiskTeams.map(t => `${t.leagueName}: ${t.injuredCount} injured`),
    playerExposureNotes: overexposure.slice(0, 4),
    positionExposureNotes: posExposure.slice(0, 3),
    timeAllocationRecommendations: timeRecs,
    summary: `Portfolio: ${teams.length} teams, ${sportMap.size} sports, health ${healthScore}/100. Top priority: ${topPriorities[0] ?? 'none'}`,
    generatedAt: new Date().toISOString(),
    sportExposureBreakdown: sportBreakdown, leaguePriorityRankings: leaguePriority,
    strategicConflictFlags: conflicts, portfolioBalanceTrend: balanceTrend,
  }
}

import type { AdaptivePlayerRank, AdaptiveRankingsOutput } from './adaptive-rankings'
import {
  type ComponentWeights,
} from './adaptive-weight-learning'

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}
import {
  computeTeamFitScore,
  computeGoalAlignment,
  computeRiskFit,
  computeUserRankScore,
  computeLeagueRankScore,
  computePositionalStrength,
  computeRosterProfile,
  type TeamByeWeeks,
  type TeamFitScoreBreakdown,
  type GoalAlignmentScore,
  type RiskFitScore,
  type PositionalStrength,
} from './team-fit-score'

export type EnhancedView = 'this_year' | 'dynasty_horizon' | 'overall'

export interface EnhancedPlayerRank extends AdaptivePlayerRank {
  leagueRankScore: number
  teamFitScore: number
  goalAlignmentScore: number
  riskFitScore: number
  userRankScore: number
  userRank: number
  tfsBreakdown: TeamFitScoreBreakdown
  goalDetails: GoalAlignmentScore
  riskDetails: RiskFitScore
}

export interface EnhancedRankingsOutput {
  view: EnhancedView
  goal: 'win-now' | 'balanced' | 'rebuild'
  players: EnhancedPlayerRank[]
  positionalStrength: PositionalStrength[]
  rosterProfile: ReturnType<typeof computeRosterProfile>
  totalPlayers: number
  userRosterSize: number
  adaptiveWeightsUsed?: ComponentWeights | null
}

const VIEW_BASE_MAP: Record<EnhancedView, string> = {
  this_year: 'win_now',
  dynasty_horizon: 'rebuild',
  overall: 'league',
}

export function computeEnhancedRankings(
  adaptiveOutput: AdaptiveRankingsOutput,
  goal: 'win-now' | 'balanced' | 'rebuild',
  view: EnhancedView,
  numTeams: number,
  adaptiveWeights?: ComponentWeights | null,
  /** This season's byes (`resolveByeWeekMap`). Omitted → no bye opinion, never a past season's. */
  byeWeeks: TeamByeWeeks = {},
): EnhancedRankingsOutput {
  const allPlayers = adaptiveOutput.players
  const userRoster = allPlayers.filter(p => p.isOnUserRoster)
  const weakestSlots = computeWeakestSlots(userRoster, allPlayers, numTeams)

  const enhanced: EnhancedPlayerRank[] = allPlayers.map(player => {
    const tfsBreakdown = computeTeamFitScore(player, weakestSlots, userRoster, goal, byeWeeks)
    const goalDetails = computeGoalAlignment(player, goal)
    const riskDetails = computeRiskFit(player, goal)
    const leagueRS = computeLeagueRankScore(player)

    const userRS = computeUserRankScore(
      player,
      leagueRS,
      tfsBreakdown.scaled,
      goalDetails.alignmentScore,
      riskDetails.riskScore,
    )

    let viewAdjustedScore: number
    if (view === 'this_year') {
      viewAdjustedScore = Math.round(
        userRS * 0.40 +
        player.impactScore * 0.35 +
        tfsBreakdown.scaled * 0.25
      )
    } else if (view === 'dynasty_horizon') {
      const normalizedMarket = clamp(player.compositeScore, 0, 100)
      viewAdjustedScore = Math.round(
        normalizedMarket * 0.30 +
        player.demandScore * 0.20 +
        tfsBreakdown.scaled * 0.20 +
        userRS * 0.15 +
        goalDetails.alignmentScore * 0.15
      )
    } else {
      viewAdjustedScore = userRS
    }

    if (adaptiveWeights) {
      const adaptiveRaw =
        adaptiveWeights.market * clamp(player.compositeScore, 0, 100) +
        adaptiveWeights.impact * clamp(player.impactScore, 0, 100) +
        adaptiveWeights.scarcity * clamp(player.scarcityScore, 0, 100) +
        adaptiveWeights.demand * clamp(player.demandScore, 0, 100)
      viewAdjustedScore = Math.round(viewAdjustedScore * 0.6 + adaptiveRaw * 0.4)
    }

    return {
      ...player,
      leagueRankScore: leagueRS,
      teamFitScore: tfsBreakdown.scaled,
      goalAlignmentScore: goalDetails.alignmentScore,
      riskFitScore: riskDetails.riskScore,
      userRankScore: viewAdjustedScore,
      userRank: 0,
      tfsBreakdown,
      goalDetails,
      riskDetails,
    }
  })

  enhanced.sort((a, b) => b.userRankScore - a.userRankScore)
  enhanced.forEach((p, i) => { p.userRank = i + 1 })

  const positionalStrength = computePositionalStrength(userRoster, allPlayers, numTeams)
  const rosterProfile = computeRosterProfile(userRoster)

  return {
    view,
    goal,
    players: enhanced,
    positionalStrength,
    rosterProfile,
    totalPlayers: enhanced.length,
    userRosterSize: userRoster.length,
    adaptiveWeightsUsed: adaptiveWeights ?? null,
  }
}

function computeWeakestSlots(
  userRoster: AdaptivePlayerRank[],
  allPlayers: AdaptivePlayerRank[],
  numTeams: number,
): { slot: string; position: string; gap: number }[] {
  const positions = ['QB', 'RB', 'WR', 'TE']
  const slots: { slot: string; position: string; gap: number }[] = []

  for (const pos of positions) {
    const userPosPlayers = userRoster.filter(p => p.position === pos)
    const userTotal = userPosPlayers.reduce((s, p) => s + p.marketValue, 0)
    const allPosValues = allPlayers.filter(p => p.position === pos).map(p => p.marketValue)
    const totalPool = allPosValues.reduce((a, b) => a + b, 0)
    const median = numTeams > 0 ? totalPool / numTeams : 0
    const gap = Math.max(0, median - userTotal)
    slots.push({ slot: pos, position: pos, gap })
  }

  return slots.sort((a, b) => b.gap - a.gap)
}

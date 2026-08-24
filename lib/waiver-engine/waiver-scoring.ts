import type { AssetValue } from '@/lib/hybrid-valuation'
import type { TeamNeedsMap, UserGoal, SlotNeed, PositionalDepth } from './team-needs'
import type { PlayerAnalytics } from '@/lib/player-analytics'
import { computeAthleticGrade, computeCollegeProductionGrade } from '@/lib/player-analytics'

export type CrowdTrendData = {
  addCount: number
  dropCount: number
  netTrend: number
  crowdSignal: 'hot_add' | 'hot_drop' | 'rising' | 'falling' | 'neutral'
  crowdScore: number
  addRank: number | null
  dropRank: number | null
}

export type WaiverDimensions = {
  startNow: number
  stash: number
  needFit: number
  leagueDemand: number
}

export type WaiverDriverId =
  | 'wa_starter_upgrade'
  | 'wa_bye_week_fill'
  | 'wa_need_slot'
  | 'wa_depth_gap'
  | 'wa_dynasty_ceiling'
  | 'wa_age_trajectory'
  | 'wa_positional_scarcity'
  | 'wa_league_demand'
  | 'wa_replacement_gain'
  | 'wa_role_trend'
  | 'wa_crowd_trend'

export type WaiverDriver = {
  id: WaiverDriverId
  label: string
  score: number
  direction: 'positive' | 'negative' | 'neutral'
  detail: string
}

export type WaiverCandidate = {
  playerId: string
  playerName: string
  position: string
  team: string | null
  /** Candidate's own bye week, when known — a player on bye cannot cover that week's cluster. */
  byeWeek?: number | null
  age: number | null
  value: number
  assetValue: AssetValue
  source: string
}

export type WaiverRosterPlayer = {
  id: string
  name: string
  position: string
  team: string | null
  slot: 'starter' | 'bench' | 'ir' | 'taxi'
  age: number | null
  value: number
  assetValue?: Partial<AssetValue>
}

export type WaiverScoringContext = {
  goal: UserGoal
  needs: string[]
  surplus: string[]
  isSF: boolean
  isTEP: boolean
  numTeams: number
  isDynasty: boolean
  rosterPlayers: WaiverRosterPlayer[]
  teamNeeds: TeamNeedsMap
  currentWeek: number
  /** League FAAB budget (real units); null/absent falls back to 100. */
  faabBudget?: number | null
  /** User's remaining FAAB; caps the suggested bid. */
  faabRemaining?: number | null
  analyticsMap?: Map<string, PlayerAnalytics>
  trendingMap?: Map<string, CrowdTrendData>
}

export type ScoredWaiverTarget = {
  playerId: string
  playerName: string
  position: string
  team: string | null
  age: number | null
  value: number
  compositeScore: number
  dimensions: WaiverDimensions
  drivers: WaiverDriver[]
  topDrivers: WaiverDriver[]
  recommendation: 'Must Add' | 'Strong Add' | 'Add' | 'Stash' | 'Monitor'
  faabBid: number | null
  priorityRank: number
  dropCandidate: {
    name: string
    position: string
    value: number
    reason: string
    riskOfRegret: number
    riskLabel: string
  } | null
}


export type WaiverIntelSignal = {
  playerName: string
  rosterFitScore: number
  opportunityScore: number
  shortTermScore: number
  longTermScore: number
  faabEfficiencyScore?: number
  explanation: string
  data: Record<string, unknown>
}
const POSITION_SCARCITY: Record<string, number> = {
  QB: 0.7,
  RB: 1.0,
  WR: 0.85,
  TE: 0.6,
  K: 0.1,
  DEF: 0.1,
}

const GOAL_WEIGHTS: Record<UserGoal, { startNow: number; stash: number; needFit: number; leagueDemand: number }> = {
  'win-now': { startNow: 0.45, needFit: 0.35, leagueDemand: 0.10, stash: 0.10 },
  'balanced': { startNow: 0.30, needFit: 0.25, stash: 0.25, leagueDemand: 0.20 },
  'rebuild': { stash: 0.45, leagueDemand: 0.25, needFit: 0.20, startNow: 0.10 },
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}

function normalize(v: number, lo: number, hi: number): number {
  if (hi <= lo) return 50
  return clamp(((v - lo) / (hi - lo)) * 100, 0, 100)
}

function computeStartNow(
  candidate: WaiverCandidate,
  ctx: WaiverScoringContext,
): number {
  const { assetValue, position, value } = candidate
  const impactBase = assetValue.impactValue || value * 0.4

  const starters = ctx.rosterPlayers.filter(p => p.slot === 'starter' && p.position === position)
  const worstStarter = [...starters].sort((a, b) => a.value - b.value)[0]
  const starterDelta = worstStarter ? Math.max(0, value - worstStarter.value) : value * 0.3

  const scarcity = POSITION_SCARCITY[position] ?? 0.5

  let score = normalize(impactBase, 500, 8000) * 0.45 +
    normalize(starterDelta, 0, 5000) * 0.35 +
    scarcity * 20

  if (ctx.goal === 'win-now') score *= 1.15
  if (ctx.goal === 'rebuild') score *= 0.7

  if (ctx.isSF && position === 'QB') score *= 1.2
  if (ctx.isTEP && position === 'TE') score *= 1.15

  const byeCluster = ctx.teamNeeds.byeWeekClusters.find(
    c => c.positionsAffected.includes(position) && c.week <= ctx.currentWeek + 2
  )
  if (byeCluster) score *= 1.15

  return clamp(Math.round(score), 0, 100)
}

function computeStash(
  candidate: WaiverCandidate,
  ctx: WaiverScoringContext,
): number {
  const { assetValue, value, age, position } = candidate
  const marketBase = assetValue.marketValue || value

  let ageCurve = 50
  if (age) {
    if (age <= 22) ageCurve = 95
    else if (age <= 24) ageCurve = 85
    else if (age <= 26) ageCurve = 60
    else if (age <= 28) ageCurve = 35
    else ageCurve = 15
  }

  const posBonus = position === 'RB' ? -5 : position === 'WR' ? 5 : position === 'QB' ? 8 : 0

  let score = normalize(marketBase, 500, 10000) * 0.45 +
    ageCurve * 0.45 +
    posBonus

  // Apply analytics-driven enhancements if available
  if (ctx.analyticsMap) {
    const analytics = ctx.analyticsMap.get(candidate.playerName)
    if (analytics) {
      // Breakout age adjustment
      if (analytics.college.breakoutAge != null) {
        if (analytics.college.breakoutAge <= 20) {
          score += 15 // Early breakout bonus
        } else if (analytics.college.breakoutAge >= 22) {
          score -= 10 // Late breakout penalty
        }
      }

      // Athleticism bonus
      if (analytics.combine.athleticismScore != null) {
        if (analytics.combine.athleticismScore >= 110) {
          score += 12
        } else if (analytics.combine.athleticismScore >= 90) {
          score += 6
        }
      }

      // College dominator premium
      if (analytics.college.dominatorRating != null && analytics.college.dominatorRating >= 30) {
        score += 8
      }
    }
  }

  if (ctx.goal === 'rebuild') score *= 1.2
  if (ctx.goal === 'win-now') score *= 0.75
  if (!ctx.isDynasty) score *= 0.3

  if (ctx.isSF && position === 'QB') score *= 1.15
  if (ctx.isTEP && position === 'TE') score *= 1.1

  return clamp(Math.round(score), 0, 100)
}

function computeNeedFit(
  candidate: WaiverCandidate,
  ctx: WaiverScoringContext,
): number {
  const { position } = candidate
  const { teamNeeds } = ctx

  let slotFitScore = 0
  const matchingSlot = teamNeeds.weakestSlots.find(s => s.position === position)
  if (matchingSlot) {
    const gapNorm = normalize(matchingSlot.gap, 500, 8000)
    slotFitScore = gapNorm * 0.6

    const rank = teamNeeds.weakestSlots.indexOf(matchingSlot)
    if (rank === 0) slotFitScore *= 1.3
    else if (rank === 1) slotFitScore *= 1.1
  } else if (ctx.needs.includes(position)) {
    slotFitScore = 35
  } else if (ctx.surplus.includes(position)) {
    slotFitScore = 5
  } else {
    slotFitScore = 20
  }

  let byeWeekBonus = 0
  for (const cluster of teamNeeds.byeWeekClusters) {
    if (cluster.positionsAffected.includes(position)) {
      // A candidate who is themselves on bye that week cannot cover the cluster.
      if (candidate.byeWeek != null && candidate.byeWeek === cluster.week) continue
      if (cluster.severity === 'critical') byeWeekBonus = Math.max(byeWeekBonus, 25)
      else if (cluster.severity === 'moderate') byeWeekBonus = Math.max(byeWeekBonus, 15)
      else byeWeekBonus = Math.max(byeWeekBonus, 8)
    }
  }

  const depthData = teamNeeds.positionalDepth.find(d => d.position === position)
  let depthBonus = 0
  if (depthData && depthData.depthRating < 40) {
    depthBonus = normalize(40 - depthData.depthRating, 0, 40) * 0.3
  }

  const samePos = ctx.rosterPlayers.filter(p => p.position === position && p.slot !== 'ir')
  const redundancyPenalty = samePos.length >= 5 ? -15 : samePos.length >= 4 ? -8 : 0

  const score = slotFitScore + byeWeekBonus + depthBonus + redundancyPenalty

  return clamp(Math.round(score), 0, 100)
}

function computeLeagueDemand(
  candidate: WaiverCandidate,
  ctx: WaiverScoringContext,
): number {
  const { position, value } = candidate

  let positionDemand = 50
  if (ctx.isSF && position === 'QB') positionDemand = 90
  else if (position === 'QB') positionDemand = 40
  else if (position === 'RB') positionDemand = 75
  else if (position === 'WR') positionDemand = 65
  else if (ctx.isTEP && position === 'TE') positionDemand = 70
  else if (position === 'TE') positionDemand = 45

  const valueTier = normalize(value, 500, 10000)

  const teamSizeFactor = ctx.numTeams >= 14 ? 1.15 : ctx.numTeams >= 12 ? 1.0 : 0.85
  const scarcityBoost = (POSITION_SCARCITY[position] ?? 0.5) * 15

  let score = positionDemand * 0.40 +
    valueTier * 0.35 +
    scarcityBoost +
    (teamSizeFactor - 1) * 50

  if (ctx.isDynasty && candidate.age && candidate.age <= 24) score *= 1.1

  if (ctx.trendingMap) {
    const trend = lookupTrending(ctx.trendingMap, candidate.playerName)
    if (trend) {
      if (trend.crowdSignal === 'hot_add') {
        score = Math.min(100, score * 1.2 + 10)
      } else if (trend.crowdSignal === 'rising') {
        score = Math.min(100, score * 1.1 + 5)
      } else if (trend.crowdSignal === 'hot_drop') {
        score = Math.max(0, score * 0.75 - 10)
      } else if (trend.crowdSignal === 'falling') {
        score = Math.max(0, score * 0.9 - 5)
      }
    }
  }

  return clamp(Math.round(score), 0, 100)
}

function normalizeName(n: string): string {
  return n.toLowerCase().replace(/[^a-z ]/g, '').replace(/\s+/g, ' ').trim()
}

function lookupTrending(map: Map<string, CrowdTrendData>, name: string): CrowdTrendData | undefined {
  return map.get(name) || map.get(normalizeName(name))
}

function computeDrivers(
  candidate: WaiverCandidate,
  ctx: WaiverScoringContext,
  dimensions: WaiverDimensions,
): WaiverDriver[] {
  const drivers: WaiverDriver[] = []

  const starters = ctx.rosterPlayers.filter(
    p => p.slot === 'starter' && p.position === candidate.position
  )
  const worstStarter = [...starters].sort((a, b) => a.value - b.value)[0]
  const replacementGain = worstStarter ? candidate.value - worstStarter.value : candidate.value * 0.3
  const replNorm = normalize(replacementGain, -2000, 5000)
  drivers.push({
    id: 'wa_starter_upgrade',
    label: 'Starter Upgrade',
    score: Math.round(replNorm),
    direction: replacementGain > 500 ? 'positive' : replacementGain < -500 ? 'negative' : 'neutral',
    detail: worstStarter
      ? `${replacementGain > 0 ? '+' : ''}${replacementGain.toLocaleString()} value vs ${worstStarter.name}`
      : `No current starter at ${candidate.position}`,
  })

  const matchingSlot = ctx.teamNeeds.weakestSlots.find(s => s.position === candidate.position)
  drivers.push({
    id: 'wa_need_slot',
    label: 'Fills Weakest Slot',
    score: matchingSlot ? Math.round(normalize(matchingSlot.gap, 500, 8000)) : ctx.needs.includes(candidate.position) ? 60 : 20,
    direction: matchingSlot ? 'positive' : ctx.needs.includes(candidate.position) ? 'positive' : 'neutral',
    detail: matchingSlot
      ? `Upgrades your ${matchingSlot.slot} (+${matchingSlot.gapPpg} PPG gap)`
      : ctx.needs.includes(candidate.position)
      ? `Fills ${candidate.position} need`
      : `${candidate.position} is adequate`,
  })

  const byeCluster = ctx.teamNeeds.byeWeekClusters.find(
    c =>
      c.positionsAffected.includes(candidate.position) &&
      !(candidate.byeWeek != null && candidate.byeWeek === c.week)
  )
  if (byeCluster) {
    drivers.push({
      id: 'wa_bye_week_fill',
      label: 'Bye Week Coverage',
      score: byeCluster.severity === 'critical' ? 85 : byeCluster.severity === 'moderate' ? 60 : 40,
      direction: 'positive',
      detail: `Covers Wk ${byeCluster.week} bye (${byeCluster.playersOut.length} starters out)`,
    })
  }

  const depthData = ctx.teamNeeds.positionalDepth.find(d => d.position === candidate.position)
  if (depthData && depthData.depthRating < 40) {
    drivers.push({
      id: 'wa_depth_gap',
      label: 'Depth Gap',
      score: Math.round(100 - depthData.depthRating),
      direction: 'positive',
      detail: `Your ${candidate.position} depth is below league median (${depthData.count} vs ${depthData.leagueMedianCount} avg)`,
    })
  }

  const age = candidate.age ?? 25
  if (ctx.isDynasty) {
    let ceilingScore = 50
    let ceilingDetail = 'Standard dynasty profile'
    if (age <= 22) { ceilingScore = 90; ceilingDetail = 'Elite dynasty ceiling — age 22 or younger' }
    else if (age <= 24) { ceilingScore = 75; ceilingDetail = 'Strong dynasty upside — entering prime' }
    else if (age >= 29) { ceilingScore = 20; ceilingDetail = 'Limited dynasty ceiling — age curve decline' }

    if (candidate.value > 5000 && age <= 25) {
      ceilingScore = Math.min(95, ceilingScore + 10)
      ceilingDetail += '. High-value young asset.'
    }

    // Enhance dynasty ceiling with analytics data when available
    if (ctx.analyticsMap) {
      const analytics = ctx.analyticsMap.get(candidate.playerName)
      if (analytics) {
        let analyticsDetail = ''
        let analyticsBoost = 0

        // Breakout age refinement
        if (analytics.college.breakoutAge != null) {
          analyticsDetail += `Early breakout age (${analytics.college.breakoutAge.toFixed(1)})`
          if (analytics.college.breakoutAge <= 20 && age <= 24) {
            analyticsBoost += 15
          } else if (analytics.college.breakoutAge > 22) {
            analyticsBoost -= 8
          }
        }

        // Athleticism profile
        if (analytics.combine.athleticismScore != null) {
          const athleticGrade = computeAthleticGrade(analytics)
          if (analyticsDetail) analyticsDetail += ', '
          analyticsDetail += `elite athletic profile (${athleticGrade.grade})`
          if (athleticGrade.score >= 90) {
            analyticsBoost += 12
          }
        }

        // Comparable players
        if (analytics.comparablePlayers && analytics.comparablePlayers.length > 0) {
          if (analyticsDetail) analyticsDetail += ', '
          analyticsDetail += `comparable to ${analytics.comparablePlayers[0]}`
        }

        if (analyticsDetail) {
          ceilingScore = clamp(ceilingScore + analyticsBoost, 0, 100)
          ceilingDetail += `. ${analyticsDetail}.`
        }
      }
    }

    drivers.push({
      id: 'wa_dynasty_ceiling',
      label: 'Dynasty Ceiling',
      score: ceilingScore,
      direction: ceilingScore >= 65 ? 'positive' : ceilingScore <= 35 ? 'negative' : 'neutral',
      detail: ceilingDetail,
    })
  }

  // Add analytics-driven age trajectory driver when analytics available
  if (ctx.analyticsMap) {
    const analytics = ctx.analyticsMap.get(candidate.playerName)
    if (analytics) {
      let trajectoryScore = 50
      let trajectoryDetail = ''
      const detailParts: string[] = []

      // Breakout age component
      if (analytics.college.breakoutAge != null) {
        const breakoutScore = analytics.college.breakoutAge <= 20 ? 80 :
          analytics.college.breakoutAge <= 21 ? 70 :
          analytics.college.breakoutAge <= 22 ? 60 :
          Math.max(20, 60 - (analytics.college.breakoutAge - 22) * 10)
        trajectoryScore = (trajectoryScore + breakoutScore) / 2
        detailParts.push(`Breakout age ${analytics.college.breakoutAge.toFixed(1)}`)
      }

      // Athletic profile component
      if (analytics.combine.athleticismScore != null) {
        const athleticGrade = computeAthleticGrade(analytics)
        if (athleticGrade.score >= 90) {
          trajectoryScore = Math.min(95, trajectoryScore + 10)
        } else if (athleticGrade.score >= 70) {
          trajectoryScore = Math.min(90, trajectoryScore + 5)
        }
        detailParts.push(`athleticism ${athleticGrade.grade} (${athleticGrade.score})`)
      }

      // College dominator rating component
      if (analytics.college.dominatorRating != null) {
        const domPercent = analytics.college.dominatorRating
        if (domPercent >= 30) {
          trajectoryScore = Math.min(95, trajectoryScore + 8)
        } else if (domPercent >= 20) {
          trajectoryScore = Math.min(90, trajectoryScore + 4)
        }
        detailParts.push(`dominator ${domPercent.toFixed(1)}%`)
      }

      if (detailParts.length > 0) {
        trajectoryDetail = detailParts.join(', ')
        drivers.push({
          id: 'wa_age_trajectory',
          label: 'Analytics Profile',
          score: Math.round(trajectoryScore),
          direction: trajectoryScore >= 70 ? 'positive' : trajectoryScore <= 40 ? 'negative' : 'neutral',
          detail: trajectoryDetail,
        })
      }
    }
  }

  let roleTrend = 50
  let roleTrendDetail = 'Stable role expected'
  if (age <= 23) { roleTrend = 80; roleTrendDetail = 'Young player with expanding role potential' }
  else if (age <= 25) { roleTrend = 65; roleTrendDetail = 'Prime trajectory — role likely growing' }
  else if (age <= 27) { roleTrend = 50; roleTrendDetail = 'Established role — stable outlook' }
  else if (age <= 29) { roleTrend = 35; roleTrendDetail = 'Veteran — role could decline' }
  else { roleTrend = 20; roleTrendDetail = 'Aging — declining role expected' }

  drivers.push({
    id: 'wa_role_trend',
    label: 'Role Trend',
    score: roleTrend,
    direction: roleTrend >= 65 ? 'positive' : roleTrend <= 35 ? 'negative' : 'neutral',
    detail: roleTrendDetail,
  })

  let scarcityScore = (POSITION_SCARCITY[candidate.position] ?? 0.5) * 100
  if (ctx.isSF && candidate.position === 'QB') scarcityScore = 95
  if (ctx.isTEP && candidate.position === 'TE') scarcityScore = Math.min(95, scarcityScore + 25)
  if (ctx.numTeams >= 14) scarcityScore = Math.min(100, scarcityScore + 10)

  drivers.push({
    id: 'wa_positional_scarcity',
    label: 'Positional Scarcity',
    score: Math.round(scarcityScore),
    direction: scarcityScore >= 70 ? 'positive' : scarcityScore <= 30 ? 'negative' : 'neutral',
    detail: scarcityScore >= 70
      ? `${candidate.position} is a scarce position in your league format`
      : `${candidate.position} is widely available`,
  })

  drivers.push({
    id: 'wa_league_demand',
    label: 'League Demand',
    score: dimensions.leagueDemand,
    direction: dimensions.leagueDemand >= 65 ? 'positive' : dimensions.leagueDemand <= 35 ? 'negative' : 'neutral',
    detail: dimensions.leagueDemand >= 65
      ? `High demand in your ${ctx.numTeams}-team ${ctx.isSF ? 'SF' : '1QB'} league`
      : `Moderate demand in your league format`,
  })

  if (ctx.trendingMap) {
    const trend = lookupTrending(ctx.trendingMap, candidate.playerName)
    if (trend) {
      let trendScore = trend.crowdScore
      let trendDetail = ''
      let trendDirection: WaiverDriver['direction'] = 'neutral'

      if (trend.crowdSignal === 'hot_add') {
        trendScore = Math.min(100, trend.crowdScore)
        trendDetail = `🔥 Hot add — ${trend.addCount.toLocaleString()} adds in 24h`
        if (trend.addRank && trend.addRank <= 5) trendDetail += ` (Top ${trend.addRank})`
        trendDirection = 'positive'
      } else if (trend.crowdSignal === 'rising') {
        trendDetail = `Trending up — ${trend.addCount.toLocaleString()} adds, net +${trend.netTrend.toLocaleString()}`
        trendDirection = 'positive'
      } else if (trend.crowdSignal === 'hot_drop') {
        trendDetail = `⚠️ Mass drop — ${trend.dropCount.toLocaleString()} drops in 24h`
        if (trend.dropRank && trend.dropRank <= 5) trendDetail += ` (Top ${trend.dropRank} dropped)`
        trendDirection = 'negative'
      } else if (trend.crowdSignal === 'falling') {
        trendDetail = `Trending down — ${trend.dropCount.toLocaleString()} drops, net ${trend.netTrend.toLocaleString()}`
        trendDirection = 'negative'
      } else {
        trendDetail = `Stable — ${trend.addCount} adds, ${trend.dropCount} drops`
      }

      drivers.push({
        id: 'wa_crowd_trend' as WaiverDriverId,
        label: 'Crowd Wisdom',
        score: Math.round(trendScore),
        direction: trendDirection,
        detail: trendDetail,
      })
    }
  }

  return drivers
}

function findDropCandidate(
  candidate: WaiverCandidate,
  ctx: WaiverScoringContext,
): ScoredWaiverTarget['dropCandidate'] {
  const dropCandidates = ctx.teamNeeds.dropCandidates

  if (dropCandidates.length === 0) {
    const benchPlayers = ctx.rosterPlayers
      .filter(p => p.slot === 'bench' && !['K', 'DEF'].includes(p.position))
      .sort((a, b) => a.value - b.value)

    if (benchPlayers.length === 0) return null
    const drop = benchPlayers[0]
    if (drop.value >= candidate.value * 0.8) return null

    return {
      name: drop.name,
      position: drop.position,
      value: drop.value,
      reason: `Lowest-value bench player (${drop.position})`,
      riskOfRegret: 10,
      riskLabel: 'Low',
    }
  }

  const samePosDrop = dropCandidates.find(d => d.position === candidate.position)
  const bestDrop = samePosDrop || dropCandidates[0]

  if (bestDrop.value >= candidate.value * 0.8) return null

  return {
    name: bestDrop.playerName,
    position: bestDrop.position,
    value: bestDrop.value,
    reason: bestDrop.reason,
    riskOfRegret: bestDrop.riskOfRegret,
    riskLabel: bestDrop.riskLabel,
  }
}

function computeComposite(dims: WaiverDimensions, goal: UserGoal): number {
  const w = GOAL_WEIGHTS[goal]
  return Math.round(
    dims.startNow * w.startNow +
    dims.stash * w.stash +
    dims.needFit * w.needFit +
    dims.leagueDemand * w.leagueDemand
  )
}

function getRecommendation(composite: number, dims: WaiverDimensions): ScoredWaiverTarget['recommendation'] {
  if (composite >= 75) return 'Must Add'
  if (composite >= 60) return 'Strong Add'
  if (composite >= 45) return 'Add'
  if (dims.stash >= 70) return 'Stash'
  if (composite >= 30) return 'Monitor'
  return 'Monitor'
}

function computeFaabBid(composite: number, ctx: WaiverScoringContext): number {
  const budget = ctx.faabBudget != null && ctx.faabBudget > 0 ? ctx.faabBudget : 100
  const basePct = composite / 100
  let bid = Math.round(basePct * 0.3 * budget)

  if (ctx.goal === 'win-now' && composite >= 70) bid = Math.round(bid * 1.3)
  if (ctx.goal === 'rebuild' && composite < 50) bid = Math.max(1, Math.round(bid * 0.6))

  const remaining = ctx.faabRemaining != null && ctx.faabRemaining >= 0 ? ctx.faabRemaining : budget
  return clamp(bid, 0, Math.min(budget, remaining))
}

function computeFaabEfficiencyScore(target: ScoredWaiverTarget): number {
  if (target.faabBid == null) return 50
  if (target.faabBid <= 0) return 80
  const valuePerFaab = target.compositeScore / target.faabBid
  return clamp(Math.round(normalize(valuePerFaab, 0.8, 3.5)), 0, 100)
}

export function buildWaiverIntelSignals(
  targets: ScoredWaiverTarget[],
  ctx: WaiverScoringContext,
): WaiverIntelSignal[] {
  return targets.map((target) => {
    const faabEfficiencyScore = computeFaabEfficiencyScore(target)
    const horizon = ctx.isDynasty ? 'long-term upside' : 'immediate lineup value'
    const explanationParts = [
      `${target.playerName} is a ${target.recommendation.toLowerCase()} candidate.`,
      `Best fit at ${target.position} with roster-fit ${target.dimensions.needFit}/100.`,
      `Priority anchored by ${horizon} and league demand ${target.dimensions.leagueDemand}/100.`,
    ]
    if (target.dropCandidate) {
      explanationParts.push(
        `Preferred drop is ${target.dropCandidate.name} (${target.dropCandidate.riskLabel} regret risk).`,
      )
    }

    return {
      playerName: target.playerName,
      rosterFitScore: target.dimensions.needFit,
      opportunityScore: target.compositeScore,
      shortTermScore: target.dimensions.startNow,
      longTermScore: target.dimensions.stash,
      faabEfficiencyScore,
      explanation: explanationParts.join(' '),
      data: {
        position: target.position,
        recommendation: target.recommendation,
        priorityRank: target.priorityRank,
        faabBid: target.faabBid,
        dropCandidate: target.dropCandidate,
        topDrivers: target.topDrivers,
      },
    }
  })
}
export function scoreWaiverCandidates(
  candidates: WaiverCandidate[],
  ctx: WaiverScoringContext,
  options?: { maxResults?: number },
): ScoredWaiverTarget[] {
  const maxResults = options?.maxResults ?? 15
  const scored: ScoredWaiverTarget[] = []

  for (const candidate of candidates) {
    if (['K', 'DEF', 'LB', 'DL', 'DB', 'EDGE', 'IDP'].includes(candidate.position)) continue
    if (candidate.value < 200) continue

    const dimensions: WaiverDimensions = {
      startNow: computeStartNow(candidate, ctx),
      stash: computeStash(candidate, ctx),
      needFit: computeNeedFit(candidate, ctx),
      leagueDemand: computeLeagueDemand(candidate, ctx),
    }

    const drivers = computeDrivers(candidate, ctx, dimensions)
    const compositeScore = computeComposite(dimensions, ctx.goal)
    const recommendation = getRecommendation(compositeScore, dimensions)
    const dropCandidate = findDropCandidate(candidate, ctx)

    const topDrivers = [...drivers]
      .sort((a, b) => b.score - a.score)
      .slice(0, 3)

    const faabBid = computeFaabBid(compositeScore, ctx)

    scored.push({
      playerId: candidate.playerId,
      playerName: candidate.playerName,
      position: candidate.position,
      team: candidate.team,
      age: candidate.age,
      value: candidate.value,
      compositeScore,
      dimensions,
      drivers,
      topDrivers,
      recommendation,
      faabBid,
      priorityRank: 0,
      dropCandidate,
    })
  }

  scored.sort((a, b) => b.compositeScore - a.compositeScore)

  for (let i = 0; i < scored.length; i++) {
    scored[i].priorityRank = i + 1
  }

  return scored.slice(0, maxResults)
}



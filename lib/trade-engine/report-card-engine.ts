import { TradeDelta } from '@/lib/hybrid-valuation'
import { isUserParty } from '@/lib/user-matching'

function matchesUser(p: { userId?: string; teamName?: string; displayName?: string }, username: string, sleeperUserId?: string): boolean {
  return isUserParty(p, username, sleeperUserId)
}

interface ThreeLensGrade {
  market: {
    atTimeGrade: string
    currentGrade: string
    atTimeDelta: number
    currentDelta: number
    trend: 'improved' | 'declined' | 'stable'
    score: number
  }
  lineupImpact: {
    starterUpgradeCount: number
    totalPlayersReceived: number
    estimatedPPGDelta: number
    realizedPPGDelta: number
    score: number
    grade: string
  }
  decisionQuality: {
    inferredGoal: 'rebuild' | 'win-now' | 'balanced' | 'unknown'
    goalAlignment: number
    reasoning: string
    score: number
    grade: string
  }
  composite: {
    score: number
    grade: string
    label: string
  }
}

interface SkillRadar {
  marketTiming: number
  starterUpgradeEfficiency: number
  riskManagement: number
  negotiationEfficiency: number
}

interface AICounterProjection {
  available: boolean
  tradesWithCounters: number
  totalTrades: number
  actualNetValue: number
  projectedNetIfFollowed: number
  netDifference: number
  message: string
}

interface ReportCardResult {
  threeLens: ThreeLensGrade
  skillRadar: SkillRadar
  aiCounterProjection: AICounterProjection
}

interface ScoredTrade {
  transactionId: string
  timestamp: number
  week: number
  grade?: string
  verdict?: string
  value: number
  parties: Array<{
    userId: string
    teamName?: string
    playersReceived: Array<{ name: string; position?: string; age?: number }>
    picksReceived: Array<{ round: number; season: string; slot?: string }>
  }>
  _analytics?: {
    atTheTime: TradeDelta | null
    withHindsight: TradeDelta | null
    comparison: string
  } | null
  _counterValue?: number | null
}

const GRADE_VALUES: Record<string, number> = {
  'A+': 95, 'A': 90, 'A-': 85,
  'B+': 80, 'B': 75, 'B-': 70,
  'C+': 65, 'C': 60, 'C-': 55,
  'D+': 50, 'D': 45, 'D-': 40,
  'F': 30
}

function scoreToGrade(score: number): string {
  if (score >= 93) return 'A+'
  if (score >= 88) return 'A'
  if (score >= 83) return 'A-'
  if (score >= 78) return 'B+'
  if (score >= 73) return 'B'
  if (score >= 68) return 'B-'
  if (score >= 63) return 'C+'
  if (score >= 58) return 'C'
  if (score >= 53) return 'C-'
  if (score >= 48) return 'D+'
  if (score >= 43) return 'D'
  if (score >= 38) return 'D-'
  return 'F'
}

function gradeLabel(grade: string): string {
  if (['A+', 'A'].includes(grade)) return 'Elite'
  if (['A-', 'B+'].includes(grade)) return 'Excellent'
  if (['B', 'B-'].includes(grade)) return 'Above Average'
  if (['C+', 'C'].includes(grade)) return 'Average'
  if (['C-', 'D+'].includes(grade)) return 'Below Average'
  return 'Poor'
}

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val))
}

function computeMarketPerformance(trades: ScoredTrade[], username: string): ThreeLensGrade['market'] {
  let atTimeTotal = 0
  let currentTotal = 0
  let atTimeCount = 0
  let currentCount = 0

  for (const trade of trades) {
    const analytics = trade._analytics
    if (analytics?.atTheTime) {
      atTimeTotal += analytics.atTheTime.deltaValue
      atTimeCount++
    }
    if (analytics?.withHindsight) {
      currentTotal += analytics.withHindsight.deltaValue
      currentCount++
    }
  }

  const atTimeDelta = atTimeCount > 0 ? Math.round(atTimeTotal) : 0
  const currentDelta = currentCount > 0 ? Math.round(currentTotal) : 0

  const atTimeAvg = atTimeCount > 0 ? atTimeTotal / atTimeCount : 0
  const currentAvg = currentCount > 0 ? currentTotal / currentCount : 0

  const atTimeScore = clamp(60 + (atTimeAvg / 200) * 15, 30, 98)
  const currentScore = clamp(60 + (currentAvg / 200) * 15, 30, 98)
  const score = Math.round((atTimeScore * 0.4 + currentScore * 0.6))

  let trend: 'improved' | 'declined' | 'stable' = 'stable'
  if (atTimeCount > 0 && currentCount > 0) {
    const diff = currentAvg - atTimeAvg
    if (diff > 200) trend = 'improved'
    else if (diff < -200) trend = 'declined'
  }

  return {
    atTimeGrade: scoreToGrade(Math.round(atTimeScore)),
    currentGrade: scoreToGrade(Math.round(currentScore)),
    atTimeDelta,
    currentDelta,
    trend,
    score,
  }
}

function computeLineupImpact(trades: ScoredTrade[], username: string, sleeperUserId?: string): ThreeLensGrade['lineupImpact'] {
  let starterUpgradeCount = 0
  let totalPlayersReceived = 0
  let estimatedPPGDelta = 0
  let realizedPPGDelta = 0

  const starterPositions = new Set(['QB', 'RB', 'WR', 'TE'])

  for (const trade of trades) {
    const userParty = trade.parties?.find(p => matchesUser(p, username, sleeperUserId))

    if (userParty) {
      const playersIn = userParty.playersReceived || []
      totalPlayersReceived += playersIn.length

      const startersIn = playersIn.filter(p => starterPositions.has(p.position || ''))
      starterUpgradeCount += startersIn.length
    }

    const analytics = trade._analytics
    if (analytics?.atTheTime) {
      const delta = analytics.atTheTime.deltaValue
      const ppgProxy = delta / 250
      estimatedPPGDelta += ppgProxy
    }
    if (analytics?.withHindsight) {
      const delta = analytics.withHindsight.deltaValue
      const ppgProxy = delta / 250
      realizedPPGDelta += ppgProxy
    }
  }

  const upgradeEfficiency = totalPlayersReceived > 0
    ? (starterUpgradeCount / totalPlayersReceived) * 100
    : 0

  const impactScore = clamp(
    60 + (realizedPPGDelta * 3) + (upgradeEfficiency * 0.15),
    30,
    98
  )

  return {
    starterUpgradeCount,
    totalPlayersReceived,
    estimatedPPGDelta: Math.round(estimatedPPGDelta * 10) / 10,
    realizedPPGDelta: Math.round(realizedPPGDelta * 10) / 10,
    score: Math.round(impactScore),
    grade: scoreToGrade(Math.round(impactScore)),
  }
}

function inferGoal(trades: ScoredTrade[], username: string, sleeperUserId?: string): 'rebuild' | 'win-now' | 'balanced' | 'unknown' {
  if (trades.length === 0) return 'unknown'

  let picksAcquired = 0
  let picksGiven = 0
  let totalAgeIn = 0
  let totalAgeOut = 0
  let ageCountIn = 0
  let ageCountOut = 0

  for (const trade of trades) {
    const userParty = trade.parties?.find(p => matchesUser(p, username, sleeperUserId))
    const otherParty = trade.parties?.find(p => !matchesUser(p, username, sleeperUserId))

    if (userParty) {
      picksAcquired += (userParty.picksReceived?.length || 0)
      for (const p of (userParty.playersReceived || [])) {
        if (p.age) { totalAgeIn += p.age; ageCountIn++ }
      }
    }
    if (otherParty) {
      picksGiven += (otherParty.picksReceived?.length || 0)
      for (const p of (otherParty.playersReceived || [])) {
        if (p.age) { totalAgeOut += p.age; ageCountOut++ }
      }
    }
  }

  const netPicksAcquired = picksAcquired - picksGiven
  const avgAgeIn = ageCountIn > 0 ? totalAgeIn / ageCountIn : 0
  const avgAgeOut = ageCountOut > 0 ? totalAgeOut / ageCountOut : 0
  const ageDelta = avgAgeIn - avgAgeOut

  let rebuildSignals = 0
  let winNowSignals = 0

  if (netPicksAcquired >= 3) rebuildSignals += 2
  else if (netPicksAcquired >= 1) rebuildSignals += 1
  else if (netPicksAcquired <= -2) winNowSignals += 2
  else if (netPicksAcquired <= -1) winNowSignals += 1

  if (ageDelta < -1.5) rebuildSignals += 2
  else if (ageDelta < 0) rebuildSignals += 1
  else if (ageDelta > 1.5) winNowSignals += 2
  else if (ageDelta > 0) winNowSignals += 1

  if (rebuildSignals >= 3 && winNowSignals <= 1) return 'rebuild'
  if (winNowSignals >= 3 && rebuildSignals <= 1) return 'win-now'
  if (rebuildSignals >= 2 || winNowSignals >= 2) return 'balanced'
  return 'unknown'
}

function computeDecisionQuality(trades: ScoredTrade[], username: string, sleeperUserId?: string): ThreeLensGrade['decisionQuality'] {
  const goal = inferGoal(trades, username, sleeperUserId)

  let alignmentScore = 0
  let total = 0
  let reasoning = ''

  for (const trade of trades) {
    const userParty = trade.parties?.find(p => matchesUser(p, username, sleeperUserId))
    const otherParty = trade.parties?.find(p => !matchesUser(p, username, sleeperUserId))

    if (!userParty) continue
    total++

    const picksIn = userParty.picksReceived?.length || 0
    const picksOut = otherParty?.picksReceived?.length || 0
    const playersIn = userParty.playersReceived || []
    const youngPlayersIn = playersIn.filter(p => (p.age || 25) < 25).length
    const oldPlayersIn = playersIn.filter(p => (p.age || 25) >= 28).length

    if (goal === 'rebuild') {
      if (picksIn > picksOut) alignmentScore += 1
      if (youngPlayersIn > oldPlayersIn) alignmentScore += 0.5
    } else if (goal === 'win-now') {
      if (picksIn < picksOut) alignmentScore += 0.5
      const starterUpgrades = playersIn.filter(p => ['QB', 'RB', 'WR', 'TE'].includes(p.position || '')).length
      if (starterUpgrades > 0) alignmentScore += 0.5
    } else {
      alignmentScore += 0.5
    }
  }

  const pct = total > 0 ? (alignmentScore / (total * 1.5)) * 100 : 50

  if (goal === 'rebuild') {
    reasoning = `Your trades suggest a rebuild strategy. ${Math.round(pct)}% of moves aligned with accumulating youth and picks.`
  } else if (goal === 'win-now') {
    reasoning = `Your trades suggest a win-now push. ${Math.round(pct)}% of moves prioritized starter upgrades.`
  } else if (goal === 'balanced') {
    reasoning = `Your trading pattern shows a balanced approach — mixing win-now upgrades with future assets.`
  } else {
    reasoning = `Not enough data to determine a clear strategy.`
  }

  const score = clamp(Math.round(40 + pct * 0.55), 30, 98)

  return {
    inferredGoal: goal,
    goalAlignment: Math.round(pct),
    reasoning,
    score,
    grade: scoreToGrade(score),
  }
}

function computeSkillRadar(trades: ScoredTrade[], username: string, sleeperUserId?: string): SkillRadar {
  const tradeCount = trades.length
  if (tradeCount === 0) {
    return { marketTiming: 50, starterUpgradeEfficiency: 50, riskManagement: 50, negotiationEfficiency: 50 }
  }

  let timingScore = 0
  let timingCount = 0
  for (const trade of trades) {
    const analytics = trade._analytics
    if (analytics?.atTheTime && analytics?.withHindsight) {
      const atTime = analytics.atTheTime.deltaValue
      const hindsight = analytics.withHindsight.deltaValue
      if (hindsight >= atTime) {
        timingScore += 1
      } else if (hindsight >= atTime * 0.8) {
        timingScore += 0.5
      }
      timingCount++
    }
  }
  const marketTiming = timingCount > 0
    ? clamp(Math.round((timingScore / timingCount) * 100), 10, 100)
    : 50

  let starterUpgrades = 0
  let totalReceived = 0
  const starterPositions = new Set(['QB', 'RB', 'WR', 'TE'])
  for (const trade of trades) {
    const userParty = trade.parties?.find(p => matchesUser(p, username, sleeperUserId))
    if (userParty) {
      const players = userParty.playersReceived || []
      totalReceived += players.length
      starterUpgrades += players.filter(p => starterPositions.has(p.position || '')).length
    }
  }
  const starterUpgradeEfficiency = totalReceived > 0
    ? clamp(Math.round((starterUpgrades / totalReceived) * 100), 10, 100)
    : 50

  let lowRiskTrades = 0
  for (const trade of trades) {
    const gradeVal = GRADE_VALUES[trade.grade || 'C'] || 60
    if (gradeVal >= 55) lowRiskTrades++
  }
  const riskManagement = clamp(Math.round((lowRiskTrades / tradeCount) * 100), 10, 100)

  let acceptedWithoutOverpay = 0
  for (const trade of trades) {
    const analytics = trade._analytics
    if (analytics?.atTheTime) {
      if (analytics.atTheTime.deltaValue >= -300) {
        acceptedWithoutOverpay++
      }
    } else {
      const gradeVal = GRADE_VALUES[trade.grade || 'C'] || 60
      if (gradeVal >= 55) acceptedWithoutOverpay++
    }
  }
  const negotiationEfficiency = clamp(Math.round((acceptedWithoutOverpay / tradeCount) * 100), 10, 100)

  return {
    marketTiming,
    starterUpgradeEfficiency,
    riskManagement,
    negotiationEfficiency,
  }
}

function computeAICounterProjection(trades: ScoredTrade[]): AICounterProjection {
  let tradesWithCounters = 0
  let actualNetValue = 0
  let projectedNetIfFollowed = 0

  for (const trade of trades) {
    const value = trade.value || 0
    actualNetValue += value

    if (trade._counterValue != null) {
      tradesWithCounters++
      projectedNetIfFollowed += trade._counterValue
    } else {
      projectedNetIfFollowed += value
    }
  }

  const netDifference = projectedNetIfFollowed - actualNetValue

  if (tradesWithCounters === 0) {
    return {
      available: false,
      tradesWithCounters: 0,
      totalTrades: trades.length,
      actualNetValue: Math.round(actualNetValue),
      projectedNetIfFollowed: 0,
      netDifference: 0,
      message: 'No AI counter-proposals found for your past trades. Use the AI Trade Evaluator to get counter-suggestions on future trades!',
    }
  }

  return {
    available: true,
    tradesWithCounters,
    totalTrades: trades.length,
    actualNetValue: Math.round(actualNetValue),
    projectedNetIfFollowed: Math.round(projectedNetIfFollowed),
    netDifference: Math.round(netDifference),
    message: netDifference > 0
      ? `If you had followed AI counter-proposals on ${tradesWithCounters} trade${tradesWithCounters !== 1 ? 's' : ''}, your projected net value would be +${Math.round(netDifference).toLocaleString()} higher.`
      : `Your actual trades outperformed AI counter-proposals by ${Math.abs(Math.round(netDifference)).toLocaleString()} — great instincts!`,
  }
}

export function computeReportCard(
  trades: ScoredTrade[],
  username: string,
  sleeperUserId?: string,
): ReportCardResult {
  const market = computeMarketPerformance(trades, username)
  const lineupImpact = computeLineupImpact(trades, username, sleeperUserId)
  const decisionQuality = computeDecisionQuality(trades, username, sleeperUserId)

  const compositeScore = Math.round(
    market.score * 0.35 +
    lineupImpact.score * 0.35 +
    decisionQuality.score * 0.30
  )

  const threeLens: ThreeLensGrade = {
    market,
    lineupImpact,
    decisionQuality,
    composite: {
      score: compositeScore,
      grade: scoreToGrade(compositeScore),
      label: gradeLabel(scoreToGrade(compositeScore)),
    },
  }

  const skillRadar = computeSkillRadar(trades, username, sleeperUserId)
  const aiCounterProjection = computeAICounterProjection(trades)

  return {
    threeLens,
    skillRadar,
    aiCounterProjection,
  }
}

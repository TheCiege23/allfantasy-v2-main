/**
 * Player Outlook Deterministic Scoring Engine
 *
 * Pure deterministic scoring. Zero AI calls. All functions are synchronous.
 * Target: under 10ms per player.
 *
 * Consumes data from existing sources (FantasyCalc, PlayerAnalytics,
 * news-impact-engine, sport-tuning-registry) and produces tiering,
 * trend, risk, and opportunity scores.
 */

import type {
  OutlookDataBundle,
  OutlookScoringResult,
  TrendDirection,
  RiskLevel,
  FormatFit,
  TimeHorizon,
} from './player-outlook-types'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}

function tierFromRank(rank: number): number {
  if (rank <= 12) return 1
  if (rank <= 24) return 2
  if (rank <= 48) return 3
  if (rank <= 72) return 4
  if (rank <= 120) return 5
  if (rank <= 200) return 6
  return 7
}

// ---------------------------------------------------------------------------
// Rest-of-Season Tier
// ---------------------------------------------------------------------------

function computeRestOfSeasonTier(bundle: OutlookDataBundle): number {
  const fc = bundle.fantasyCalc
  if (!fc) return 5 // no data → below average

  let tier = tierFromRank(fc.overallRank)

  // Trend adjustment
  if (bundle.trend30Day != null) {
    if (bundle.trend30Day > 200) tier -= 1       // strong upward
    else if (bundle.trend30Day < -200) tier += 1  // strong downward
  }

  // Injury adjustment
  if (bundle.injuryStatus && bundle.injuryStatus !== 'Active' && bundle.injuryStatus !== 'Healthy') {
    if (bundle.injuryStatus === 'IR' || bundle.injuryStatus === 'Out') tier += 1
    else tier += 0 // Questionable/Doubtful don't change ROS tier
  }

  // Age adjustment
  if (bundle.ageCurve && bundle.age != null) {
    if (bundle.age > bundle.ageCurve.cliffAge) tier += 1
    else if (bundle.age > bundle.ageCurve.declineAge) tier += 0 // already factored into value
  }

  // Scarcity adjustment (premium positions get a boost)
  if (bundle.scarcity && bundle.scarcity.multiplier > 1.1) {
    tier -= 1
  }

  return clamp(tier, 1, 7)
}

// ---------------------------------------------------------------------------
// Weekly Tier
// ---------------------------------------------------------------------------

function computeWeeklyTier(bundle: OutlookDataBundle): number {
  const fpg = bundle.fantasyPointsPerGame
  if (fpg == null) {
    // Fallback to value-based estimate
    return bundle.fantasyCalc ? tierFromRank(bundle.fantasyCalc.overallRank) : 5
  }

  // Tier from fantasy points per game
  let tier: number
  if (fpg >= 20) tier = 1
  else if (fpg >= 16) tier = 2
  else if (fpg >= 12) tier = 3
  else if (fpg >= 9) tier = 4
  else if (fpg >= 6) tier = 5
  else if (fpg >= 3) tier = 6
  else tier = 7

  // Volatility penalty
  if (bundle.weeklyVolatility != null && bundle.weeklyVolatility > 0.25) {
    tier += 1 // volatile players are less reliable weekly
  }

  // Trend boost
  if (bundle.trendType === 'hot_streak') tier -= 1
  if (bundle.trendType === 'cold_streak') tier += 1

  // Injury impact on weekly
  if (bundle.injuryStatus && bundle.injuryStatus !== 'Active' && bundle.injuryStatus !== 'Healthy') {
    tier += 2 // injured players can't produce weekly
  }

  return clamp(tier, 1, 7)
}

// ---------------------------------------------------------------------------
// Dynasty Tier
// ---------------------------------------------------------------------------

function computeDynastyTier(bundle: OutlookDataBundle): number {
  const fc = bundle.fantasyCalc
  if (!fc) return 5

  let tier = tierFromRank(fc.overallRank)

  // Youth premium
  if (bundle.ageCurve && bundle.age != null) {
    if (bundle.age < bundle.ageCurve.peakAge - 3) tier -= 1 // significant youth
    else if (bundle.age > bundle.ageCurve.declineAge) tier += 1
    else if (bundle.age > bundle.ageCurve.cliffAge) tier += 2
  }

  // Analytics premium
  if (bundle.breakoutAge != null && bundle.breakoutAge < 20) tier -= 1
  if (bundle.dominatorRating != null && bundle.dominatorRating > 0.30) tier -= 1
  if (bundle.athleticGrade === 'A+' || bundle.athleticGrade === 'A') tier -= 0 // don't double-count

  return clamp(tier, 1, 7)
}

// ---------------------------------------------------------------------------
// Trend
// ---------------------------------------------------------------------------

function computeTrend(bundle: OutlookDataBundle): { direction: TrendDirection; strength: number } {
  const trend30Day = bundle.trend30Day ?? 0
  const newsAdj = bundle.newsAdjustments?.[0]?.adjustmentPct ?? 0

  // Combined signal (FantasyCalc scale + news impact)
  const fc = bundle.fantasyCalc
  const value = fc?.value ?? 3000
  const combinedTrend = trend30Day + (newsAdj * value * 0.01)

  let direction: TrendDirection
  if (combinedTrend > 100) direction = 'buy'
  else if (combinedTrend < -100) direction = 'sell'
  else direction = 'hold'

  // Override from explicit trend type
  if (bundle.trendType === 'sell_high_candidate') direction = 'sell'
  if (bundle.trendType === 'breakout_candidate' && direction === 'hold') direction = 'buy'

  const strength = clamp(Math.round(Math.abs(combinedTrend) / 5), 0, 100)

  return { direction, strength }
}

// ---------------------------------------------------------------------------
// Risk Level
// ---------------------------------------------------------------------------

function computeRiskLevel(bundle: OutlookDataBundle): RiskLevel {
  let riskScore = 0

  // Injury
  if (bundle.injuryStatus && bundle.injuryStatus !== 'Active' && bundle.injuryStatus !== 'Healthy') {
    riskScore += 1
    if (bundle.injuryStatus === 'IR' || bundle.injuryStatus === 'Out') riskScore += 1
  }

  // Age
  if (bundle.ageCurve && bundle.age != null) {
    if (bundle.age > bundle.ageCurve.cliffAge) riskScore += 2
    else if (bundle.age > bundle.ageCurve.declineAge) riskScore += 1
  }

  // Volatility
  const volProfile = bundle.volatilityProfile
  if (bundle.weeklyVolatility != null && volProfile) {
    if (bundle.weeklyVolatility > volProfile.baseVolatility * 1.5) riskScore += 1
  }

  // News volatility
  if (bundle.newsVolatilityIncrease) riskScore += 1

  if (riskScore >= 4) return 'extreme'
  if (riskScore >= 3) return 'high'
  if (riskScore >= 2) return 'moderate'
  return 'low'
}

// ---------------------------------------------------------------------------
// Opportunity Score (0-100)
// ---------------------------------------------------------------------------

function computeOpportunityScore(bundle: OutlookDataBundle): number {
  let score = 40 // baseline

  // Value-based opportunity
  const fc = bundle.fantasyCalc
  if (fc) {
    if (fc.overallRank <= 24) score += 20
    else if (fc.overallRank <= 48) score += 10
    else if (fc.overallRank <= 96) score += 5
  }

  // Trend signal
  if (bundle.trendType === 'breakout_candidate') score += 15
  if (bundle.trendType === 'hot_streak') score += 10
  if (bundle.trend30Day != null && bundle.trend30Day > 300) score += 10

  // Youth + analytics (opportunity for growth)
  if (bundle.age != null && bundle.age <= 24) score += 5
  if (bundle.breakoutAge != null && bundle.breakoutAge < 20) score += 5
  if (bundle.dominatorRating != null && bundle.dominatorRating > 0.25) score += 5

  // Injury drag
  if (bundle.injuryStatus && bundle.injuryStatus !== 'Active' && bundle.injuryStatus !== 'Healthy') {
    score -= 15
  }

  return clamp(Math.round(score), 0, 100)
}

// ---------------------------------------------------------------------------
// Role Security Score (0-100)
// ---------------------------------------------------------------------------

function computeRoleSecurityScore(bundle: OutlookDataBundle): number {
  const fc = bundle.fantasyCalc
  if (!fc) return 30

  // Base from rank (top players have more secure roles)
  let score = clamp(Math.round(100 - fc.overallRank * 0.5), 10, 90)

  // Scarcity boost (harder to replace = more secure)
  if (bundle.scarcity && bundle.scarcity.multiplier > 1.1) score += 10

  // Injury penalty
  if (bundle.injuryStatus && bundle.injuryStatus !== 'Active' && bundle.injuryStatus !== 'Healthy') {
    score -= 15
  }

  // Age penalty past decline
  if (bundle.ageCurve && bundle.age != null) {
    if (bundle.age > bundle.ageCurve.declineAge) {
      const yearsPastDecline = bundle.age - bundle.ageCurve.declineAge
      score -= yearsPastDecline * 5
    }
  }

  return clamp(Math.round(score), 0, 100)
}

// ---------------------------------------------------------------------------
// Summary Generation (template-based, no AI)
// ---------------------------------------------------------------------------

function generateRecentTrendSummary(bundle: OutlookDataBundle, trend: { direction: TrendDirection; strength: number }): string {
  const parts: string[] = []

  if (trend.direction === 'buy') {
    parts.push(`Rising value (${trend.strength}/100 strength)`)
  } else if (trend.direction === 'sell') {
    parts.push(`Declining value (${trend.strength}/100 strength)`)
  } else {
    parts.push('Stable value')
  }

  if (bundle.trend30Day != null) {
    const dir = bundle.trend30Day > 0 ? '+' : ''
    parts.push(`30-day movement: ${dir}${bundle.trend30Day}`)
  }

  if (bundle.trendType) {
    const labels: Record<string, string> = {
      hot_streak: 'on a hot streak',
      cold_streak: 'on a cold streak',
      breakout_candidate: 'breakout candidate',
      sell_high_candidate: 'sell-high window',
    }
    if (labels[bundle.trendType]) parts.push(labels[bundle.trendType])
  }

  return parts.join('. ') + '.'
}

function generateOutlookSummary(bundle: OutlookDataBundle, scoring: Partial<OutlookScoringResult>): string {
  const rosTier = scoring.restOfSeasonTier ?? 4
  const tierLabel = rosTier <= 2 ? 'elite' : rosTier <= 4 ? 'solid' : 'limited'
  const trendLabel = scoring.trend === 'buy' ? 'Rising' : scoring.trend === 'sell' ? 'Declining' : 'Stable'
  const riskNote = scoring.riskLevel !== 'low' ? `, ${scoring.riskLevel} risk` : ''

  return `${bundle.position} with ${tierLabel} ROS value. ${trendLabel} trend${riskNote}.`
}

function generateBullishCase(bundle: OutlookDataBundle, scoring: Partial<OutlookScoringResult>): string {
  const points: string[] = []

  if (scoring.opportunityScore != null && scoring.opportunityScore >= 60) {
    points.push('Strong role/usage opportunity')
  }
  if (bundle.age != null && bundle.ageCurve && bundle.age < bundle.ageCurve.peakAge) {
    points.push(`Still ascending (age ${bundle.age}, peak at ${bundle.ageCurve.peakAge})`)
  }
  if (bundle.trend30Day != null && bundle.trend30Day > 100) {
    points.push('Value trending upward')
  }
  if (bundle.breakoutAge != null && bundle.breakoutAge < 20) {
    points.push('Early breakout profile')
  }
  if (bundle.dominatorRating != null && bundle.dominatorRating > 0.30) {
    points.push(`Strong college dominator (${(bundle.dominatorRating * 100).toFixed(0)}%)`)
  }
  if (bundle.fantasyPointsPerGame != null && bundle.fantasyPointsPerGame >= 15) {
    points.push(`Producing at ${bundle.fantasyPointsPerGame.toFixed(1)} PPG`)
  }

  return points.length > 0 ? points.join('. ') + '.' : 'Limited bullish signals available.'
}

function generateBearishCase(bundle: OutlookDataBundle, scoring: Partial<OutlookScoringResult>): string {
  const points: string[] = []

  if (bundle.injuryStatus && bundle.injuryStatus !== 'Active' && bundle.injuryStatus !== 'Healthy') {
    points.push(`Currently ${bundle.injuryStatus}`)
  }
  if (bundle.age != null && bundle.ageCurve && bundle.age > bundle.ageCurve.declineAge) {
    points.push(`Past decline age (${bundle.age} vs ${bundle.ageCurve.declineAge} threshold)`)
  }
  if (bundle.weeklyVolatility != null && bundle.weeklyVolatility > 0.25) {
    points.push('High weekly volatility — inconsistent production')
  }
  if (bundle.trend30Day != null && bundle.trend30Day < -100) {
    points.push('Value trending downward')
  }
  if (bundle.trendType === 'cold_streak') {
    points.push('Currently on a cold streak')
  }
  if (scoring.roleSecurityScore != null && scoring.roleSecurityScore < 40) {
    points.push('Low role security — could lose playing time')
  }

  return points.length > 0 ? points.join('. ') + '.' : 'No major bearish signals identified.'
}

// ---------------------------------------------------------------------------
// Tag & Risk Flag Classification
// ---------------------------------------------------------------------------

function classifyTags(bundle: OutlookDataBundle, scoring: Partial<OutlookScoringResult>): string[] {
  const tags: string[] = []

  // Value-based tags
  const fc = bundle.fantasyCalc
  if (scoring.trend === 'sell' && fc && fc.overallRank <= 50) tags.push('sell_high')
  if (scoring.trend === 'buy' && fc && fc.overallRank > 60) tags.push('buy_low')

  // Trend tags
  if (bundle.trendType === 'breakout_candidate') tags.push('breakout_candidate')
  if (bundle.trendType === 'sell_high_candidate') tags.push('sell_high')

  // Profile tags
  if (bundle.weeklyVolatility != null && bundle.weeklyVolatility > 0.25) tags.push('volatile')
  if (bundle.weeklyVolatility != null && bundle.weeklyVolatility < 0.12) tags.push('consistent')

  // Dynasty tags
  if (bundle.age != null && bundle.age <= 23 && fc && fc.value >= 3000) tags.push('dynasty_asset')
  if (scoring.dynastyTier != null && scoring.weeklyTier != null && scoring.dynastyTier <= scoring.weeklyTier - 2) {
    tags.push('stash')
  }

  // Role tags
  if (scoring.roleSecurityScore != null && scoring.roleSecurityScore >= 75) tags.push('locked_in_role')
  if (scoring.opportunityScore != null && scoring.opportunityScore >= 70) tags.push('high_opportunity')

  // Value tags
  if (fc && fc.overallRank <= 12) tags.push('elite')
  if (fc && fc.overallRank <= 36 && bundle.age != null && bundle.age <= 25) tags.push('cornerstone')

  return [...new Set(tags)]
}

function classifyRiskFlags(bundle: OutlookDataBundle): string[] {
  const flags: string[] = []

  if (bundle.injuryStatus && bundle.injuryStatus !== 'Active' && bundle.injuryStatus !== 'Healthy') {
    flags.push('injury_concern')
  }
  if (bundle.age != null && bundle.ageCurve && bundle.age > bundle.ageCurve.cliffAge) {
    flags.push('age_cliff')
  }
  if (bundle.trend30Day != null && bundle.trend30Day < -300) {
    flags.push('declining_value')
  }
  if (bundle.weeklyVolatility != null && bundle.weeklyVolatility > 0.30) {
    flags.push('high_volatility')
  }
  if (bundle.newsVolatilityIncrease) {
    flags.push('news_driven_volatility')
  }

  return flags
}

// ---------------------------------------------------------------------------
// Data Completeness & Confidence
// ---------------------------------------------------------------------------

function computeDataCompleteness(bundle: OutlookDataBundle): number {
  let score = 0
  if (bundle.fantasyCalc) score += 25
  if (bundle.analytics) score += 25
  if (bundle.fantasyPointsPerGame != null) score += 15
  if (bundle.trend30Day != null) score += 10
  if (bundle.newsAdjustments && bundle.newsAdjustments.length > 0) score += 10
  if (bundle.ageCurve) score += 5
  if (bundle.volatilityProfile) score += 5
  if (bundle.age != null) score += 5
  return clamp(score, 0, 100)
}

function computeConfidence(completeness: number, scoring: Partial<OutlookScoringResult>): number {
  let confidence = completeness

  // Reduce if we're missing critical data
  if (!scoring.restOfSeasonTier || scoring.restOfSeasonTier === 5) confidence -= 5
  if (scoring.trend === 'hold' && (scoring.trendStrength ?? 0) < 20) confidence -= 5

  return clamp(Math.round(confidence), 0, 100)
}

// ---------------------------------------------------------------------------
// Format Fit & Time Horizon
// ---------------------------------------------------------------------------

function classifyFormatFit(bundle: OutlookDataBundle, scoring: Partial<OutlookScoringResult>): FormatFit {
  const rosTier = scoring.restOfSeasonTier ?? 4
  const dynTier = scoring.dynastyTier ?? 4

  // Strong in both → all formats
  if (rosTier <= 3 && dynTier <= 3) return 'all'

  // Strong ROS but weak dynasty → redraft
  if (rosTier <= 3 && dynTier >= 5) return 'redraft'

  // Weak ROS but strong dynasty → dynasty
  if (rosTier >= 5 && dynTier <= 3) return 'dynasty'

  // Moderate both → keeper
  if (rosTier <= 4 && dynTier <= 4) return 'keeper'

  return 'all'
}

function classifyTimeHorizon(bundle: OutlookDataBundle, scoring: Partial<OutlookScoringResult>): TimeHorizon {
  if (bundle.age != null && bundle.age <= 24 && scoring.dynastyTier != null && scoring.dynastyTier <= 3) {
    return 'long_term'
  }
  if (bundle.age != null && bundle.ageCurve && bundle.age > bundle.ageCurve.declineAge) {
    return 'short_term'
  }
  return 'medium_term'
}

// ---------------------------------------------------------------------------
// Main Entry Point
// ---------------------------------------------------------------------------

export function computePlayerOutlookScores(bundle: OutlookDataBundle): OutlookScoringResult {
  const restOfSeasonTier = computeRestOfSeasonTier(bundle)
  const weeklyTier = computeWeeklyTier(bundle)
  const dynastyTier = computeDynastyTier(bundle)
  const { direction: trend, strength: trendStrength } = computeTrend(bundle)
  const riskLevel = computeRiskLevel(bundle)
  const opportunityScore = computeOpportunityScore(bundle)
  const roleSecurityScore = computeRoleSecurityScore(bundle)

  // Build partial for summary generation
  const partial = {
    restOfSeasonTier,
    weeklyTier,
    dynastyTier,
    trend,
    trendStrength,
    riskLevel,
    opportunityScore,
    roleSecurityScore,
  }

  const recentTrendSummary = generateRecentTrendSummary(bundle, { direction: trend, strength: trendStrength })
  const outlookSummary = generateOutlookSummary(bundle, partial)
  const bullishCase = generateBullishCase(bundle, partial)
  const bearishCase = generateBearishCase(bundle, partial)
  const tags = classifyTags(bundle, partial)
  const riskFlags = classifyRiskFlags(bundle)
  const bestFormatFit = classifyFormatFit(bundle, partial)
  const timeHorizon = classifyTimeHorizon(bundle, partial)
  const dataCompleteness = computeDataCompleteness(bundle)
  const confidencePct = computeConfidence(dataCompleteness, partial)

  return {
    restOfSeasonTier,
    weeklyTier,
    dynastyTier,
    trend,
    trendStrength,
    riskLevel,
    opportunityScore,
    roleSecurityScore,
    recentTrendSummary,
    outlookSummary,
    bullishCase,
    bearishCase,
    bestFormatFit,
    timeHorizon,
    tags,
    riskFlags,
    dataCompleteness,
    confidencePct,
  }
}

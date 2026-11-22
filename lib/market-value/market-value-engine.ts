/**
 * AI Market Value Engine
 *
 * Player value intelligence: buy/sell/hold, trend detection, timing,
 * overreaction/sustainability analysis. Central value layer for all tools.
 *
 * Pure deterministic. <10ms per player.
 */

import { z } from 'zod'
import { getAgeCurve, computeAgeMultiplier } from '@/lib/trade-engine/sport-tuning-registry'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

const MarketModeEnum = z.enum([
  'all_players', 'watchlist', 'my_roster', 'league_targets', 'trending',
  'buy_low', 'sell_high', 'crash_risk', 'breakout_watch',
])

const TimeHorizonEnum = z.enum([
  'this_week', 'short_term', 'rest_of_season', 'dynasty', 'devy', 'c2c_long_range',
])

type MarketLabel = 'strong_buy' | 'buy' | 'hold' | 'sell' | 'strong_sell' | 'watch'
type TrendDirection = 'rising' | 'stable' | 'falling' | 'volatile'

interface MarketPlayerInput {
  playerId: string
  playerName: string
  team: string | null
  position: string
  age: number | null
  currentValue: number
  trend30Day: number
  recentProduction: number | null // PPG
  weeklyVolatility: number | null
  injuryStatus: string
  roleStability: number | null // 0-100
  newsImpact: number | null // -100 to +100
}

export const MarketValueInputSchema = z.object({
  sport: z.string().default('NFL'),
  leagueType: z.string().default('dynasty'),
  marketMode: MarketModeEnum.default('all_players'),
  timeHorizon: TimeHorizonEnum.default('rest_of_season'),
  players: z.array(z.object({
    playerId: z.string(), playerName: z.string(), team: z.string().nullable(),
    position: z.string(), age: z.number().nullable(), currentValue: z.number(),
    trend30Day: z.number().default(0), recentProduction: z.number().nullable(),
    weeklyVolatility: z.number().nullable(), injuryStatus: z.string().default('healthy'),
    roleStability: z.number().nullable(), newsImpact: z.number().nullable(),
  })),
})
type MarketValueInput = z.infer<typeof MarketValueInputSchema>

interface MarketPlayerResult {
  playerId: string
  playerName: string
  team: string | null
  position: string
  marketLabel: MarketLabel
  trendDirection: TrendDirection
  trendStrength: number
  confidencePct: number
  currentValueScore: number
  futureValueScore: number
  timingScore: number
  marketInefficiencyScore: number
  volatilityScore: number
  shortSummary: string
  whyNow: string
  bullishCase: string
  bearishCase: string
  catalysts: string[]
  risks: string[]
  suggestedAction: string
  urgencyLabel: 'low' | 'medium' | 'high'
  priceTagNote: string
}

interface MarketValueResult {
  marketMode: string
  timeHorizon: string
  generatedAt: string
  players: MarketPlayerResult[]
  topBuys: string[]
  topSells: string[]
  topHolds: string[]
  breakoutWatch: string[]
  crashWatch: string[]
  marketSummary: string
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}

// ---------------------------------------------------------------------------
// Player Market Analysis
// ---------------------------------------------------------------------------

function analyzePlayer(player: MarketPlayerInput, sport: string, horizon: string): MarketPlayerResult {
  const { trend30Day, currentValue, age, position, recentProduction, weeklyVolatility, injuryStatus, roleStability, newsImpact } = player

  // Trend direction
  let trendDirection: TrendDirection = 'stable'
  if (trend30Day > 200) trendDirection = 'rising'
  else if (trend30Day < -200) trendDirection = 'falling'
  else if (weeklyVolatility != null && weeklyVolatility > 0.3) trendDirection = 'volatile'

  const trendStrength = clamp(Math.round(Math.abs(trend30Day) / 5), 0, 100)

  // Current value score (0-100 based on rank-equivalent)
  const currentValueScore = clamp(Math.round(Math.min(currentValue / 100, 100)), 0, 100)

  // Future value score
  let futureValueScore = currentValueScore
  if (age != null) {
    const ageCurve = getAgeCurve(sport, position)
    if (ageCurve) {
      const mult3yr = computeAgeMultiplier(sport, position, age + 3)
      futureValueScore = clamp(Math.round(currentValueScore * mult3yr), 0, 100)
    }
  }

  // Timing score (0-100: higher = better time to act)
  let timingScore = 50
  if (trendDirection === 'falling' && currentValue >= 5000) timingScore += 20 // buy low window
  if (trendDirection === 'rising' && currentValue >= 5000) timingScore += 15 // sell high window
  if (newsImpact != null && Math.abs(newsImpact) >= 30) timingScore += 15
  if (injuryStatus !== 'healthy') timingScore += 10 // injury creates opportunity
  timingScore = clamp(timingScore, 0, 100)

  // Market inefficiency score
  let marketInefficiencyScore = 0
  if (recentProduction != null && currentValue > 0) {
    // Compare production to value — high production + low value = undervalued
    const productionRatio = recentProduction / (currentValue / 500)
    if (productionRatio > 1.3) marketInefficiencyScore = 70 // undervalued
    else if (productionRatio < 0.7) marketInefficiencyScore = -50 // overvalued
  }
  if (trendDirection === 'falling' && (roleStability ?? 50) >= 70) {
    marketInefficiencyScore = Math.max(marketInefficiencyScore, 60) // value dropping but role is stable
  }
  marketInefficiencyScore = clamp(Math.round(50 + marketInefficiencyScore), 0, 100)

  // Volatility score
  const volatilityScore = clamp(Math.round((weeklyVolatility ?? 0.2) * 200), 0, 100)

  // Market label
  let marketLabel: MarketLabel = 'hold'
  const buySignal = (trendDirection === 'falling' && marketInefficiencyScore >= 60) ||
    (futureValueScore > currentValueScore + 15)
  const sellSignal = (trendDirection === 'rising' && futureValueScore < currentValueScore - 15) ||
    (age != null && getAgeCurve(sport, position) && age > (getAgeCurve(sport, position)?.declineAge ?? 30))

  if (buySignal && timingScore >= 65) marketLabel = 'strong_buy'
  else if (buySignal) marketLabel = 'buy'
  else if (sellSignal && timingScore >= 65) marketLabel = 'strong_sell'
  else if (sellSignal) marketLabel = 'sell'
  else if (trendDirection === 'volatile') marketLabel = 'watch'

  // Confidence
  let confidencePct = 50
  if (roleStability != null && roleStability >= 70) confidencePct += 15
  if (Math.abs(trend30Day) >= 300) confidencePct += 10
  if (recentProduction != null) confidencePct += 10
  confidencePct = clamp(confidencePct, 20, 90)

  // Summaries
  const shortSummary = marketLabel === 'strong_buy' ? `${player.playerName} is significantly undervalued. Buy window open.`
    : marketLabel === 'buy' ? `${player.playerName} is a buy candidate — value trending favorably.`
    : marketLabel === 'strong_sell' ? `${player.playerName} at peak value. Sell before decline.`
    : marketLabel === 'sell' ? `${player.playerName} is a sell candidate — value may drop.`
    : marketLabel === 'watch' ? `${player.playerName} is volatile. Watch and wait for clarity.`
    : `${player.playerName} is fairly valued. Hold unless a clear upgrade is available.`

  const whyNow = timingScore >= 65
    ? `Market conditions favor action now. ${newsImpact != null && Math.abs(newsImpact) >= 20 ? 'Recent news has created a window.' : 'Trend momentum is strong.'}`
    : 'No urgent timing factor — standard market conditions.'

  const bullishCase = futureValueScore > currentValueScore
    ? `Youth and trajectory suggest value appreciation. ${age != null && age <= 25 ? 'Still ascending.' : 'Room for growth.'}`
    : 'Current production supports present value.'

  const bearishCase = futureValueScore < currentValueScore
    ? `Age curve projects value decline. ${age != null ? `Age ${age} past positional peak.` : 'Production may not sustain.'}`
    : injuryStatus !== 'healthy' ? `Currently ${injuryStatus} — health uncertainty.` : 'No major bearish signals.'

  const catalysts: string[] = []
  if (trendDirection === 'rising') catalysts.push('Value trending upward')
  if (newsImpact != null && newsImpact > 20) catalysts.push('Positive news catalyst')
  if (roleStability != null && roleStability >= 80) catalysts.push('Locked-in role')

  const risks: string[] = []
  if (injuryStatus !== 'healthy') risks.push(`Injury: ${injuryStatus}`)
  if (volatilityScore >= 60) risks.push('High weekly volatility')
  if (futureValueScore < currentValueScore - 20) risks.push('Significant value decline projected')

  const urgencyLabel: 'low' | 'medium' | 'high' =
    timingScore >= 70 ? 'high' : timingScore >= 50 ? 'medium' : 'low'

  const suggestedAction = marketLabel.includes('buy') ? `Acquire ${player.playerName} — ${marketLabel === 'strong_buy' ? 'priority target' : 'value opportunity'}`
    : marketLabel.includes('sell') ? `Move ${player.playerName} — ${marketLabel === 'strong_sell' ? 'urgent sell' : 'look for offers'}`
    : `Hold ${player.playerName} — no clear action needed`

  const priceTagNote = currentValue >= 8000 ? 'Premium asset — expect to pay premium'
    : currentValue >= 4000 ? 'Mid-tier value — fair market deals possible'
    : 'Affordable — low acquisition cost'

  return {
    playerId: player.playerId, playerName: player.playerName,
    team: player.team, position: player.position,
    marketLabel, trendDirection, trendStrength, confidencePct,
    currentValueScore, futureValueScore, timingScore,
    marketInefficiencyScore, volatilityScore,
    shortSummary, whyNow, bullishCase, bearishCase,
    catalysts, risks, suggestedAction, urgencyLabel, priceTagNote,
  }
}

// ---------------------------------------------------------------------------
// Main Entry Point
// ---------------------------------------------------------------------------

export function analyzeMarketValue(input: MarketValueInput): MarketValueResult {
  const analyzed = input.players.map(p => analyzePlayer(p, input.sport, input.timeHorizon))

  // Filter by mode
  let filtered = analyzed
  switch (input.marketMode) {
    case 'buy_low': filtered = analyzed.filter(p => p.marketLabel === 'strong_buy' || p.marketLabel === 'buy'); break
    case 'sell_high': filtered = analyzed.filter(p => p.marketLabel === 'strong_sell' || p.marketLabel === 'sell'); break
    case 'crash_risk': filtered = analyzed.filter(p => p.futureValueScore < p.currentValueScore - 15); break
    case 'breakout_watch': filtered = analyzed.filter(p => p.trendDirection === 'rising' && p.marketInefficiencyScore >= 60); break
    case 'trending': filtered = analyzed.filter(p => p.trendStrength >= 40); break
    default: break
  }

  // Sort by timing urgency
  filtered.sort((a, b) => b.timingScore - a.timingScore)

  const topBuys = filtered.filter(p => p.marketLabel.includes('buy')).slice(0, 5).map(p => p.playerName)
  const topSells = filtered.filter(p => p.marketLabel.includes('sell')).slice(0, 5).map(p => p.playerName)
  const topHolds = filtered.filter(p => p.marketLabel === 'hold').slice(0, 5).map(p => p.playerName)
  const breakoutWatch = filtered.filter(p => p.trendDirection === 'rising' && p.marketInefficiencyScore >= 55).slice(0, 5).map(p => p.playerName)
  const crashWatch = filtered.filter(p => p.futureValueScore < p.currentValueScore - 20).slice(0, 5).map(p => p.playerName)

  return {
    marketMode: input.marketMode,
    timeHorizon: input.timeHorizon,
    generatedAt: new Date().toISOString(),
    players: filtered,
    topBuys, topSells, topHolds, breakoutWatch, crashWatch,
    marketSummary: `Analyzed ${input.players.length} players. ${topBuys.length} buy candidates, ${topSells.length} sell candidates, ${breakoutWatch.length} breakout watches.`,
  }
}

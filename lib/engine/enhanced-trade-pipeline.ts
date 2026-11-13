/**
 * lib/engine/enhanced-trade-pipeline.ts
 * Enhanced trade analysis pipeline — integrates all new modules:
 * - Universal Trade Value (UTV)
 * - Multi-factor valuation (7-factor model)
 * - Risk model (6-factor, separate from value)
 * - Team context adjustment
 * - Enhanced pick valuation
 * - Logarithmic fairness engine
 *
 * This module wraps the existing runTradeAnalysis() and enriches its output.
 * Drop-in compatible: same TradeEngineRequest in, enhanced TradeEngineResponse out.
 *
 * Performance target: <300ms total for the math layer.
 */

import type {
  TradeEngineRequest,
  TradeEngineResponse,
  TradePlayerAsset,
  Asset,
  SportKey,
} from './trade-types'
import { computeMultiFactorValue, type PlayerValuationInput } from './multi-factor-valuation'
import { computeRiskScore, applyRiskDiscount, type RiskInput } from './risk-model'
import { computeUTV, computePickUTV, normalizeToUTV } from './utv'
import { computeTeamContext, applyTeamContextToPlayer, type TeamContextInput } from './team-context-adjustment'
import { computeEnhancedFairness, type FairnessInput } from './enhanced-fairness'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface EnhancedAssetValuation {
  name: string
  type: 'player' | 'pick' | 'faab'
  position?: string
  /** Raw multi-factor value (0–1000) */
  rawValue: number
  /** Risk score (0–1) */
  riskScore: number
  /** Risk-adjusted value: rawValue - (risk × 0.25 × rawValue) */
  riskAdjustedValue: number
  /** Team-context adjusted value */
  contextAdjustedValue: number
  /** Universal Trade Value (0–1000 sport-normalized) */
  utv: number
  /** Risk label */
  riskLabel: string
  /** Risk warnings */
  warnings: string[]
  /** Valuation confidence */
  confidence: 'high' | 'medium' | 'low'
}

export interface EnhancedTradeAnalysis {
  /** Assets with enhanced valuations */
  sideA: EnhancedAssetValuation[]
  sideB: EnhancedAssetValuation[]
  /** Total values per side */
  totalA: number
  totalB: number
  /** Enhanced fairness */
  fairness: {
    score: number
    tier: 'balanced' | 'slight_edge' | 'moderate_edge' | 'lopsided'
    favoredSide: 'A' | 'B' | 'even'
    delta: number
    impactDelta: number
    explanations: string[]
  }
  /** Team context for each side */
  teamContextA: {
    window: string
    needs: string[]
    winPct: number
    pointsDiff: number
    benchStrength: number
  } | null
  teamContextB: {
    window: string
    needs: string[]
    winPct: number
    pointsDiff: number
    benchStrength: number
  } | null
  /** Sport this trade was evaluated under */
  sport: SportKey
  /** Execution time in ms */
  executionMs: number
}

// ---------------------------------------------------------------------------
// Main pipeline
// ---------------------------------------------------------------------------

/**
 * Run the enhanced trade analysis pipeline.
 * This is a SUPPLEMENT to runTradeAnalysis(), not a replacement.
 * Call both and merge results for maximum accuracy.
 */
export function runEnhancedPipeline(
  req: TradeEngineRequest,
  existingPricedA: Array<{ name: string; type: string; value: number; position?: string; age?: number }>,
  existingPricedB: Array<{ name: string; type: string; value: number; position?: string; age?: number }>,
  starterImpactA?: number,
  starterImpactB?: number,
): EnhancedTradeAnalysis {
  const start = Date.now()
  const sport = req.sport ?? req.leagueContext?.sport ?? 'NFL'
  const currentYear = req.leagueContext?.season ?? new Date().getFullYear()

  // ─── 1. TEAM CONTEXT ───
  let teamCtxA: ReturnType<typeof computeTeamContext> | null = null
  let teamCtxB: ReturnType<typeof computeTeamContext> | null = null

  if (req.rosterA && req.rosterA.length > 0) {
    teamCtxA = computeTeamContext(buildTeamContextInput(req, 'A', sport))
  }
  if (req.rosterB && req.rosterB.length > 0) {
    teamCtxB = computeTeamContext(buildTeamContextInput(req, 'B', sport))
  }

  // ─── 2. ENHANCED ASSET VALUATION — Side A ───
  const sideA = existingPricedA.map(item =>
    valuateAsset(item, req, sport, currentYear, teamCtxA, 'A')
  )

  // ─── 3. ENHANCED ASSET VALUATION — Side B ───
  const sideB = existingPricedB.map(item =>
    valuateAsset(item, req, sport, currentYear, teamCtxB, 'B')
  )

  // ─── 4. TOTALS ───
  const totalA = sideA.reduce((sum, a) => sum + a.contextAdjustedValue, 0)
  const totalB = sideB.reduce((sum, a) => sum + a.contextAdjustedValue, 0)

  // ─── 5. ENHANCED FAIRNESS ───
  const fairnessInput: FairnessInput = {
    valueA: totalA,
    valueB: totalB,
    impactDeltaA: starterImpactA,
    impactDeltaB: starterImpactB,
    managerWinPctA: teamCtxA?.winPct,
    managerWinPctB: teamCtxB?.winPct,
    ppgA: teamCtxA ? (teamCtxA.pointsDiff > 0 ? 100 + teamCtxA.pointsDiff : 100) : undefined,
    ppgB: teamCtxB ? (teamCtxB.pointsDiff > 0 ? 100 + teamCtxB.pointsDiff : 100) : undefined,
  }
  const fairness = computeEnhancedFairness(fairnessInput)

  const executionMs = Date.now() - start

  return {
    sideA,
    sideB,
    totalA: Math.round(totalA),
    totalB: Math.round(totalB),
    fairness: {
      score: fairness.score,
      tier: fairness.tier,
      favoredSide: fairness.favoredSide,
      delta: fairness.delta,
      impactDelta: fairness.impactDelta,
      explanations: fairness.explanations,
    },
    teamContextA: teamCtxA ? {
      window: teamCtxA.window,
      needs: teamCtxA.needs,
      winPct: teamCtxA.winPct,
      pointsDiff: teamCtxA.pointsDiff,
      benchStrength: teamCtxA.benchStrength,
    } : null,
    teamContextB: teamCtxB ? {
      window: teamCtxB.window,
      needs: teamCtxB.needs,
      winPct: teamCtxB.winPct,
      pointsDiff: teamCtxB.pointsDiff,
      benchStrength: teamCtxB.benchStrength,
    } : null,
    sport,
    executionMs,
  }
}

// ---------------------------------------------------------------------------
// Asset valuation
// ---------------------------------------------------------------------------

function valuateAsset(
  item: { name: string; type: string; value: number; position?: string; age?: number },
  req: TradeEngineRequest,
  sport: SportKey,
  currentYear: number,
  teamCtx: ReturnType<typeof computeTeamContext> | null,
  side: 'A' | 'B',
): EnhancedAssetValuation {
  const position = item.position ?? ''

  if (item.type === 'pick') {
    return valuatePick(item, sport, currentYear, req.format)
  }

  if (item.type === 'faab') {
    return {
      name: item.name,
      type: 'faab',
      rawValue: item.value,
      riskScore: 0,
      riskAdjustedValue: item.value,
      contextAdjustedValue: item.value,
      utv: Math.round(item.value / 10), // FAAB on 0–1000 = amount/10
      riskLabel: 'low',
      warnings: [],
      confidence: 'high',
    }
  }

  // ─── Player valuation ───
  const nflCtx = req.nflContext?.players?.[item.name.toLowerCase()]

  // Multi-factor valuation
  const mfInput: PlayerValuationInput = {
    name: item.name,
    position,
    sport,
    age: item.age,
    marketValue: normalizeToUTV(item.value, sport, position),
    vorpValue: Math.round(item.value * 0.85), // Approximate VORP from market
    teamImpact: teamCtx ? Math.round(item.value * teamCtx.multiplier) : undefined,
    consistencyScore: nflCtx?.trend ? computeConsistencyFromTrend(nflCtx.trend) : undefined,
    usageTrend: nflCtx?.usage ? computeUsageScore(nflCtx.usage) : undefined,
  }
  const mfResult = computeMultiFactorValue(mfInput)

  // Risk model
  const riskInput: RiskInput = {
    name: item.name,
    position,
    sport,
    age: item.age,
    injuryStatus: nflCtx?.injuryStatus,
    expectedReturnWeeks: nflCtx?.expectedReturnWeeks,
    snapPercentage: nflCtx?.usage?.snapPct,
    coachingChange: nflCtx?.coachingChange,
    depthChartPosition: nflCtx?.depthChartChange ? 2 : 1,
  }
  const risk = computeRiskScore(riskInput)

  // Risk-adjusted value
  const riskAdjusted = applyRiskDiscount(mfResult.totalValue, risk.totalRisk)

  // Team context adjusted
  const contextAdjusted = teamCtx
    ? applyTeamContextToPlayer(riskAdjusted, position, teamCtx)
    : riskAdjusted

  // UTV
  const utv = computeUTV({
    marketValue: item.value,
    internalTradeValue: null,
    fantasyCalcValue: null,
    sport,
    position,
    tradeVolume: 0,
  })

  return {
    name: item.name,
    type: 'player',
    position,
    rawValue: mfResult.totalValue,
    riskScore: risk.totalRisk,
    riskAdjustedValue: riskAdjusted,
    contextAdjustedValue: contextAdjusted,
    utv,
    riskLabel: risk.riskLabel,
    warnings: risk.warnings,
    confidence: mfResult.confidence,
  }
}

function valuatePick(
  item: { name: string; value: number },
  sport: SportKey,
  currentYear: number,
  format: string,
): EnhancedAssetValuation {
  // Parse pick info from name (e.g. "2026 1st Round (Early)")
  const yearMatch = item.name.match(/(\d{4})/)
  const roundMatch = item.name.match(/(\d+)(?:st|nd|rd|th)/i)
  const tierMatch = item.name.toLowerCase()
  const year = yearMatch ? parseInt(yearMatch[1]) : currentYear + 1
  const round = roundMatch ? parseInt(roundMatch[1]) : 1
  const tier: 'early' | 'mid' | 'late' = tierMatch.includes('early') ? 'early' : tierMatch.includes('late') ? 'late' : 'mid'

  const utv = computePickUTV({
    year, round, tier, sport,
    format: format as 'dynasty' | 'redraft' | 'keeper',
    currentYear,
  })

  return {
    name: item.name,
    type: 'pick',
    rawValue: utv,
    riskScore: 0.15, // Picks have inherent moderate risk
    riskAdjustedValue: applyRiskDiscount(utv, 0.15),
    contextAdjustedValue: applyRiskDiscount(utv, 0.15),
    utv,
    riskLabel: 'moderate',
    warnings: year > currentYear + 1 ? [`${year - currentYear} years out`] : [],
    confidence: 'medium',
  }
}

// ---------------------------------------------------------------------------
// Helper builders
// ---------------------------------------------------------------------------

function buildTeamContextInput(
  req: TradeEngineRequest,
  side: 'A' | 'B',
  sport: SportKey,
): TeamContextInput {
  const roster = side === 'A' ? (req.rosterA ?? []) : (req.rosterB ?? [])
  // Extract team record from market context or default
  return {
    sport,
    roster,
    wins: 0,
    losses: 0,
    pointsFor: 0,
    pointsAgainst: 0,
    direction: undefined,
    totalTeams: req.numTeams ?? req.leagueContext?.numTeams ?? 12,
    rosterSlots: req.leagueContext?.roster?.slots,
  }
}

function computeConsistencyFromTrend(trend: { last4Points?: number; seasonPoints?: number }): number {
  if (!trend.last4Points || !trend.seasonPoints) return 50
  // If last 4 weeks are close to season average, high consistency
  const weeklyAvg = trend.seasonPoints / 14 // approximate
  const recentAvg = trend.last4Points / 4
  const variance = Math.abs(recentAvg - weeklyAvg) / Math.max(weeklyAvg, 1)
  return Math.round(Math.max(0, Math.min(100, 80 - variance * 100)))
}

function computeUsageScore(usage: {
  snapPct?: number; targetsPg?: number; carriesPg?: number;
}): number {
  let score = 50
  if (usage.snapPct != null) {
    score = Math.round(usage.snapPct * 0.8) // 80% snap = 64 usage score
  }
  if (usage.targetsPg != null && usage.targetsPg > 6) score += 10
  if (usage.carriesPg != null && usage.carriesPg > 15) score += 10
  return Math.min(100, score)
}

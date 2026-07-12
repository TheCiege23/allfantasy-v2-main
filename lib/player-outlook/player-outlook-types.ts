/**
 * Player Outlook Types & Zod Schemas
 *
 * Defines the complete PlayerOutlook contract consumed by:
 * trade analyzer, waiver AI, draft assistant, Chimmy chat, and the API.
 */

import { z } from 'zod'
import type { FantasyCalcPlayer } from '@/lib/player-valuations/canonicalPlayerValuations'
import type { PlayerAnalytics } from '@/lib/player-analytics'
import type { AgeCurve, VolatilityProfile, PositionScarcity } from '@/lib/trade-engine/sport-tuning-registry'
import type { PlayerValueAdjustment } from '@/lib/trade-engine/news-impact-engine'

// ---------------------------------------------------------------------------
// Core Enums
// ---------------------------------------------------------------------------

export const TrendDirectionEnum = z.enum(['buy', 'sell', 'hold'])
export type TrendDirection = z.infer<typeof TrendDirectionEnum>

export const RiskLevelEnum = z.enum(['low', 'moderate', 'high', 'extreme'])
export type RiskLevel = z.infer<typeof RiskLevelEnum>

export const TimeHorizonEnum = z.enum(['short_term', 'medium_term', 'long_term'])
export type TimeHorizon = z.infer<typeof TimeHorizonEnum>

export const FormatFitEnum = z.enum(['redraft', 'dynasty', 'keeper', 'all'])
export type FormatFit = z.infer<typeof FormatFitEnum>

// ---------------------------------------------------------------------------
// Tier Labels (for UI display)
// ---------------------------------------------------------------------------

export const TIER_LABELS: Record<number, string> = {
  1: 'Elite',
  2: 'Strong',
  3: 'Solid',
  4: 'Average',
  5: 'Below Avg',
  6: 'Risky',
  7: 'Avoid',
}

// ---------------------------------------------------------------------------
// PlayerOutlook — the final output
// ---------------------------------------------------------------------------

export const PlayerOutlookSchema = z.object({
  // Identity
  playerName: z.string(),
  playerId: z.string().nullable(),
  sport: z.string(),
  position: z.string(),
  team: z.string().nullable(),

  // Value snapshot
  currentValue: z.number(),
  currentRank: z.number(),
  positionRank: z.number(),

  // Tiering (1-7 scale: 1=Elite, 7=Avoid)
  restOfSeasonTier: z.number().int().min(1).max(7),
  weeklyTier: z.number().int().min(1).max(7),
  dynastyTier: z.number().int().min(1).max(7),

  // Actionability
  trend: TrendDirectionEnum,
  trendStrength: z.number().min(0).max(100),
  confidencePct: z.number().min(0).max(100),

  // Risk & opportunity
  riskLevel: RiskLevelEnum,
  opportunityScore: z.number().min(0).max(100),
  roleSecurityScore: z.number().min(0).max(100),

  // Summaries
  recentTrendSummary: z.string(),
  outlookSummary: z.string(),
  bullishCase: z.string(),
  bearishCase: z.string(),

  // Classification
  bestFormatFit: FormatFitEnum,
  timeHorizon: TimeHorizonEnum,
  tags: z.array(z.string()),
  riskFlags: z.array(z.string()),

  // AI narrative (nullable — deterministic output stands alone)
  narrative: z.string().nullable(),

  // Metadata
  sourcesUsed: z.array(z.string()),
  dataCompleteness: z.number().min(0).max(100),
  updatedAt: z.string(),
  fromCache: z.boolean(),
  cacheAge: z.number().nullable(),
})

export type PlayerOutlook = z.infer<typeof PlayerOutlookSchema>

// ---------------------------------------------------------------------------
// Data Bundle — raw gathered data before scoring
// ---------------------------------------------------------------------------

export interface OutlookDataBundle {
  playerName: string
  playerId: string | null
  sport: string
  position: string
  team: string | null
  age: number | null

  // Data sources (all optional — graceful degradation)
  fantasyCalc: FantasyCalcPlayer | null
  analytics: PlayerAnalytics | null
  newsAdjustments: PlayerValueAdjustment[] | null
  ageCurve: AgeCurve | null
  volatilityProfile: VolatilityProfile | null
  scarcity: PositionScarcity | null

  // Stats (from UnifiedPlayer or rolling insights)
  fantasyPointsPerGame: number | null
  gamesPlayed: number | null
  seasonStats: Record<string, unknown> | null

  // Trend data
  trend30Day: number | null
  trendType: string | null // hot_streak, cold_streak, breakout_candidate, sell_high_candidate

  // Status
  injuryStatus: string | null // Active, Out, IR, Questionable, etc.
  weeklyVolatility: number | null
  newsVolatilityIncrease: boolean

  // Dynasty-specific
  breakoutAge: number | null
  dominatorRating: number | null
  athleticGrade: string | null // A+, A, B+, etc.
}

// ---------------------------------------------------------------------------
// Scoring Result — intermediate output from the engine
// ---------------------------------------------------------------------------

export interface OutlookScoringResult {
  restOfSeasonTier: number
  weeklyTier: number
  dynastyTier: number
  trend: TrendDirection
  trendStrength: number
  riskLevel: RiskLevel
  opportunityScore: number
  roleSecurityScore: number
  recentTrendSummary: string
  outlookSummary: string
  bullishCase: string
  bearishCase: string
  bestFormatFit: FormatFit
  timeHorizon: TimeHorizon
  tags: string[]
  riskFlags: string[]
  dataCompleteness: number
  confidencePct: number
}

// ---------------------------------------------------------------------------
// API Request Schemas
// ---------------------------------------------------------------------------

export const PlayerOutlookRequestSchema = z.object({
  playerName: z.string().optional(),
  playerId: z.string().optional(),
  sport: z.string().default('NFL'),
  narrative: z.boolean().optional().default(false),
}).refine(
  (data) => data.playerName || data.playerId,
  { message: 'Either playerName or playerId is required' },
)

export const PlayerOutlookBatchRequestSchema = z.object({
  players: z.array(z.object({
    playerName: z.string(),
    sport: z.string().default('NFL'),
  })).min(1).max(10),
  narrative: z.boolean().optional().default(false),
})

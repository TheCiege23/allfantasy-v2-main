/**
 * Sport Tuning Registry
 *
 * Unified trade evaluation system with sport-specific modifiers.
 * All sports use the SAME core evaluation pipeline, but each sport
 * injects its own positional scarcity, scoring normalization,
 * roster size weights, and volatility profiles.
 */
import { DAILY_SPORT_SEASON_SHAPE } from '@/lib/sportConfig/dailySportSeasonShape'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SupportedSport = 'NFL' | 'NBA' | 'MLB' | 'NHL' | 'NCAAF' | 'NCAAB' | 'SOCCER'

export interface PositionScarcity {
  position: string
  /** Scarcity multiplier (1.0 = baseline, >1.0 = scarce/premium, <1.0 = replaceable) */
  multiplier: number
  /** Replacement-level threshold — value below which a player is replaceable */
  replacementThreshold: number
}

export interface AgeCurve {
  position: string
  /** Peak production age */
  peakAge: number
  /** Age at which value starts declining meaningfully */
  declineAge: number
  /** Age at which value falls off a cliff */
  cliffAge: number
  /** Annual depreciation rate once past decline (0-1) */
  depreciationRate: number
}

export interface VolatilityProfile {
  position: string
  /** Base weekly volatility (0-1) */
  baseVolatility: number
  /** Consistency bonus — how much consistency matters in this sport (0-1) */
  consistencyWeight: number
}

export interface ScoringNormalization {
  /** Name of the scoring format */
  format: string
  /** Position multipliers applied to base values */
  positionMultipliers: Record<string, number>
  /** Overall scaling factor to normalize across sports (target: 0-10000 scale) */
  scaleFactor: number
}

export interface SportTuning {
  sport: SupportedSport
  /** Display name */
  displayName: string
  /** Typical season length in weeks */
  seasonWeeks: number
  /** Number of starter slots (typical) */
  typicalStarters: number
  /** Positional scarcity table */
  scarcity: PositionScarcity[]
  /** Age curves by position */
  ageCurves: AgeCurve[]
  /** Weekly volatility profiles */
  volatility: VolatilityProfile[]
  /** Scoring format normalizations */
  scoringFormats: ScoringNormalization[]
  /** Default score standard deviation for simulations */
  defaultScoreStdDev: number
  /** Max career length expectation (years) */
  maxCareerYears: number
  /** Whether to apply a consistency boost (low-scoring sports) */
  consistencyBoost: boolean
}

// ---------------------------------------------------------------------------
// NFL Tuning
// ---------------------------------------------------------------------------

const NFL_TUNING: SportTuning = {
  sport: 'NFL',
  displayName: 'NFL Fantasy Football',
  seasonWeeks: 18,
  typicalStarters: 9,
  defaultScoreStdDev: 15,
  maxCareerYears: 15,
  consistencyBoost: false,
  scarcity: [
    { position: 'QB', multiplier: 1.0, replacementThreshold: 2000 },    // 1QB default
    { position: 'QB_SF', multiplier: 1.3, replacementThreshold: 3500 }, // Superflex
    { position: 'RB', multiplier: 1.15, replacementThreshold: 2500 },
    { position: 'WR', multiplier: 1.0, replacementThreshold: 2000 },
    { position: 'TE', multiplier: 0.85, replacementThreshold: 1500 },
    { position: 'TE_TEP', multiplier: 1.2, replacementThreshold: 2500 }, // TE Premium
    { position: 'K', multiplier: 0.3, replacementThreshold: 200 },
    { position: 'DEF', multiplier: 0.3, replacementThreshold: 200 },
    { position: 'DL', multiplier: 0.20, replacementThreshold: 500 },
    { position: 'LB', multiplier: 0.22, replacementThreshold: 500 },
    { position: 'DB', multiplier: 0.18, replacementThreshold: 500 },
  ],
  ageCurves: [
    { position: 'QB', peakAge: 30, declineAge: 33, cliffAge: 37, depreciationRate: 0.08 },
    { position: 'RB', peakAge: 25, declineAge: 27, cliffAge: 30, depreciationRate: 0.15 },
    { position: 'WR', peakAge: 27, declineAge: 30, cliffAge: 33, depreciationRate: 0.10 },
    { position: 'TE', peakAge: 28, declineAge: 31, cliffAge: 34, depreciationRate: 0.10 },
    { position: 'K', peakAge: 32, declineAge: 36, cliffAge: 40, depreciationRate: 0.05 },
    { position: 'DEF', peakAge: 28, declineAge: 30, cliffAge: 33, depreciationRate: 0.12 },
  ],
  volatility: [
    { position: 'QB', baseVolatility: 0.12, consistencyWeight: 0.3 },
    { position: 'RB', baseVolatility: 0.30, consistencyWeight: 0.5 },
    { position: 'WR', baseVolatility: 0.18, consistencyWeight: 0.4 },
    { position: 'TE', baseVolatility: 0.22, consistencyWeight: 0.4 },
    { position: 'K', baseVolatility: 0.10, consistencyWeight: 0.1 },
    { position: 'DEF', baseVolatility: 0.10, consistencyWeight: 0.1 },
  ],
  scoringFormats: [
    {
      format: 'PPR',
      positionMultipliers: { QB: 1.0, RB: 0.95, WR: 1.10, TE: 1.0, K: 1.0, DEF: 1.0 },
      scaleFactor: 1.0,
    },
    {
      format: 'Half-PPR',
      positionMultipliers: { QB: 1.0, RB: 1.0, WR: 1.05, TE: 1.0, K: 1.0, DEF: 1.0 },
      scaleFactor: 1.0,
    },
    {
      format: 'Standard',
      positionMultipliers: { QB: 1.0, RB: 1.15, WR: 0.90, TE: 0.90, K: 1.0, DEF: 1.0 },
      scaleFactor: 1.0,
    },
  ],
}

// ---------------------------------------------------------------------------
// NBA Tuning
// ---------------------------------------------------------------------------

const NBA_TUNING: SportTuning = {
  sport: 'NBA',
  displayName: 'NBA Fantasy Basketball',
  seasonWeeks: DAILY_SPORT_SEASON_SHAPE.NBA.totalWeeks,
  typicalStarters: 10,
  defaultScoreStdDev: 12,
  maxCareerYears: 18,
  consistencyBoost: false,
  scarcity: [
    { position: 'PG', multiplier: 1.10, replacementThreshold: 2000 },
    { position: 'SG', multiplier: 0.95, replacementThreshold: 1800 },
    { position: 'SF', multiplier: 1.00, replacementThreshold: 1800 },
    { position: 'PF', multiplier: 1.00, replacementThreshold: 1800 },
    { position: 'C', multiplier: 1.15, replacementThreshold: 2200 },   // Centers are scarce
    { position: 'G', multiplier: 1.0, replacementThreshold: 1500 },
    { position: 'F', multiplier: 1.0, replacementThreshold: 1500 },
    { position: 'UTIL', multiplier: 0.85, replacementThreshold: 1200 },
  ],
  ageCurves: [
    { position: 'PG', peakAge: 27, declineAge: 31, cliffAge: 35, depreciationRate: 0.10 },
    { position: 'SG', peakAge: 27, declineAge: 31, cliffAge: 35, depreciationRate: 0.10 },
    { position: 'SF', peakAge: 27, declineAge: 31, cliffAge: 34, depreciationRate: 0.10 },
    { position: 'PF', peakAge: 27, declineAge: 30, cliffAge: 34, depreciationRate: 0.12 },
    { position: 'C', peakAge: 28, declineAge: 31, cliffAge: 34, depreciationRate: 0.12 },
  ],
  volatility: [
    { position: 'PG', baseVolatility: 0.15, consistencyWeight: 0.4 },
    { position: 'SG', baseVolatility: 0.18, consistencyWeight: 0.4 },
    { position: 'SF', baseVolatility: 0.16, consistencyWeight: 0.4 },
    { position: 'PF', baseVolatility: 0.17, consistencyWeight: 0.4 },
    { position: 'C', baseVolatility: 0.14, consistencyWeight: 0.5 },    // Big men are more consistent
  ],
  scoringFormats: [
    {
      format: 'Points',
      positionMultipliers: { PG: 1.05, SG: 1.0, SF: 1.0, PF: 1.0, C: 1.05 },
      scaleFactor: 0.85,  // NBA values normalized lower than NFL
    },
    {
      format: 'Categories',
      positionMultipliers: { PG: 1.10, SG: 0.95, SF: 1.0, PF: 1.0, C: 1.15 },
      scaleFactor: 0.85,
    },
  ],
}

// ---------------------------------------------------------------------------
// MLB Tuning
// ---------------------------------------------------------------------------

const MLB_TUNING: SportTuning = {
  sport: 'MLB',
  displayName: 'MLB Fantasy Baseball',
  seasonWeeks: DAILY_SPORT_SEASON_SHAPE.MLB.totalWeeks,
  typicalStarters: 14,
  defaultScoreStdDev: 14,
  maxCareerYears: 20,
  consistencyBoost: false,
  scarcity: [
    { position: 'SP', multiplier: 1.25, replacementThreshold: 2500 },   // Ace pitchers are premium
    { position: 'RP', multiplier: 0.70, replacementThreshold: 1000 },
    { position: 'C', multiplier: 1.10, replacementThreshold: 1500 },    // Catchers are scarce
    { position: '1B', multiplier: 0.85, replacementThreshold: 1500 },
    { position: '2B', multiplier: 1.0, replacementThreshold: 1500 },
    { position: '3B', multiplier: 1.0, replacementThreshold: 1500 },
    { position: 'SS', multiplier: 1.15, replacementThreshold: 2000 },   // Elite SS are scarce
    { position: 'OF', multiplier: 0.90, replacementThreshold: 1500 },   // Deep position
    { position: 'DH', multiplier: 0.75, replacementThreshold: 1200 },
    { position: 'P', multiplier: 1.0, replacementThreshold: 1500 },
  ],
  ageCurves: [
    { position: 'SP', peakAge: 28, declineAge: 32, cliffAge: 36, depreciationRate: 0.08 },
    { position: 'RP', peakAge: 29, declineAge: 33, cliffAge: 37, depreciationRate: 0.08 },
    { position: 'C', peakAge: 28, declineAge: 32, cliffAge: 35, depreciationRate: 0.10 },
    { position: '1B', peakAge: 29, declineAge: 33, cliffAge: 37, depreciationRate: 0.07 },
    { position: '2B', peakAge: 28, declineAge: 32, cliffAge: 35, depreciationRate: 0.08 },
    { position: '3B', peakAge: 28, declineAge: 32, cliffAge: 36, depreciationRate: 0.08 },
    { position: 'SS', peakAge: 27, declineAge: 31, cliffAge: 34, depreciationRate: 0.10 },
    { position: 'OF', peakAge: 28, declineAge: 32, cliffAge: 36, depreciationRate: 0.08 },
  ],
  volatility: [
    { position: 'SP', baseVolatility: 0.28, consistencyWeight: 0.6 },   // Pitchers are volatile
    { position: 'RP', baseVolatility: 0.35, consistencyWeight: 0.5 },   // Closers very volatile
    { position: 'C', baseVolatility: 0.20, consistencyWeight: 0.4 },
    { position: '1B', baseVolatility: 0.18, consistencyWeight: 0.3 },
    { position: '2B', baseVolatility: 0.18, consistencyWeight: 0.3 },
    { position: '3B', baseVolatility: 0.18, consistencyWeight: 0.3 },
    { position: 'SS', baseVolatility: 0.18, consistencyWeight: 0.3 },
    { position: 'OF', baseVolatility: 0.20, consistencyWeight: 0.3 },
  ],
  scoringFormats: [
    {
      format: 'Points',
      positionMultipliers: { SP: 1.15, RP: 0.80, C: 1.0, '1B': 1.0, '2B': 1.0, '3B': 1.0, SS: 1.05, OF: 1.0, DH: 0.90 },
      scaleFactor: 0.75,  // MLB values normalized lower
    },
    {
      format: 'Categories',
      positionMultipliers: { SP: 1.25, RP: 0.85, C: 0.95, '1B': 1.0, '2B': 1.0, '3B': 1.0, SS: 1.10, OF: 1.0, DH: 0.85 },
      scaleFactor: 0.75,
    },
  ],
}

// ---------------------------------------------------------------------------
// NHL Tuning
// ---------------------------------------------------------------------------

const NHL_TUNING: SportTuning = {
  sport: 'NHL',
  displayName: 'NHL Fantasy Hockey',
  seasonWeeks: DAILY_SPORT_SEASON_SHAPE.NHL.totalWeeks,
  typicalStarters: 10,
  defaultScoreStdDev: 18,
  maxCareerYears: 18,
  consistencyBoost: false,
  scarcity: [
    { position: 'C', multiplier: 1.15, replacementThreshold: 2000 },
    { position: 'LW', multiplier: 1.0, replacementThreshold: 1500 },
    { position: 'RW', multiplier: 1.0, replacementThreshold: 1500 },
    { position: 'D', multiplier: 1.10, replacementThreshold: 1800 },    // Good defensemen are scarce
    { position: 'G', multiplier: 1.20, replacementThreshold: 2200 },    // Elite goalies are rare
    { position: 'UTIL', multiplier: 0.85, replacementThreshold: 1200 },
  ],
  ageCurves: [
    { position: 'C', peakAge: 27, declineAge: 31, cliffAge: 35, depreciationRate: 0.10 },
    { position: 'LW', peakAge: 27, declineAge: 31, cliffAge: 35, depreciationRate: 0.10 },
    { position: 'RW', peakAge: 27, declineAge: 31, cliffAge: 35, depreciationRate: 0.10 },
    { position: 'D', peakAge: 28, declineAge: 32, cliffAge: 36, depreciationRate: 0.08 },
    { position: 'G', peakAge: 29, declineAge: 33, cliffAge: 37, depreciationRate: 0.08 },
  ],
  volatility: [
    { position: 'C', baseVolatility: 0.22, consistencyWeight: 0.4 },
    { position: 'LW', baseVolatility: 0.24, consistencyWeight: 0.4 },
    { position: 'RW', baseVolatility: 0.24, consistencyWeight: 0.4 },
    { position: 'D', baseVolatility: 0.20, consistencyWeight: 0.5 },
    { position: 'G', baseVolatility: 0.30, consistencyWeight: 0.6 },    // Goalies are high-variance
  ],
  scoringFormats: [
    {
      format: 'Points',
      positionMultipliers: { C: 1.10, LW: 1.0, RW: 1.0, D: 1.05, G: 1.15 },
      scaleFactor: 0.80,
    },
    {
      format: 'Categories',
      positionMultipliers: { C: 1.15, LW: 1.0, RW: 1.0, D: 1.10, G: 1.25 },
      scaleFactor: 0.80,
    },
  ],
}

// ---------------------------------------------------------------------------
// SOCCER Tuning
// ---------------------------------------------------------------------------

const SOCCER_TUNING: SportTuning = {
  sport: 'SOCCER',
  displayName: 'Fantasy Soccer',
  seasonWeeks: 38,
  typicalStarters: 11,
  defaultScoreStdDev: 10,
  maxCareerYears: 18,
  consistencyBoost: true,  // Low-scoring sport → consistency matters more
  scarcity: [
    { position: 'GKP', multiplier: 0.60, replacementThreshold: 800 },
    { position: 'DEF', multiplier: 0.80, replacementThreshold: 1000 },
    { position: 'MID', multiplier: 1.10, replacementThreshold: 1800 },   // Goal-scoring midfielders are premium
    { position: 'FWD', multiplier: 1.25, replacementThreshold: 2200 },   // Elite strikers are scarce
  ],
  ageCurves: [
    { position: 'GKP', peakAge: 30, declineAge: 34, cliffAge: 38, depreciationRate: 0.06 },
    { position: 'DEF', peakAge: 29, declineAge: 33, cliffAge: 36, depreciationRate: 0.08 },
    { position: 'MID', peakAge: 28, declineAge: 32, cliffAge: 35, depreciationRate: 0.10 },
    { position: 'FWD', peakAge: 27, declineAge: 31, cliffAge: 34, depreciationRate: 0.12 },
  ],
  volatility: [
    { position: 'GKP', baseVolatility: 0.12, consistencyWeight: 0.7 },
    { position: 'DEF', baseVolatility: 0.14, consistencyWeight: 0.6 },
    { position: 'MID', baseVolatility: 0.18, consistencyWeight: 0.5 },
    { position: 'FWD', baseVolatility: 0.25, consistencyWeight: 0.5 },
  ],
  scoringFormats: [
    {
      format: 'Standard',
      positionMultipliers: { GKP: 0.70, DEF: 0.85, MID: 1.10, FWD: 1.25 },
      scaleFactor: 0.70,
    },
  ],
}

// ---------------------------------------------------------------------------
// College Sports (NCAAF, NCAAB)
// ---------------------------------------------------------------------------

const NCAAF_TUNING: SportTuning = {
  sport: 'NCAAF',
  displayName: 'College Fantasy Football',
  seasonWeeks: 15,
  typicalStarters: 9,
  defaultScoreStdDev: 14,
  maxCareerYears: 4,
  consistencyBoost: false,
  scarcity: [
    { position: 'QB', multiplier: 1.20, replacementThreshold: 1500 },
    { position: 'RB', multiplier: 1.10, replacementThreshold: 1200 },
    { position: 'WR', multiplier: 1.0, replacementThreshold: 1000 },
    { position: 'TE', multiplier: 0.80, replacementThreshold: 800 },
    { position: 'K', multiplier: 0.25, replacementThreshold: 200 },
    { position: 'DEF', multiplier: 0.25, replacementThreshold: 200 },
  ],
  ageCurves: [
    { position: 'QB', peakAge: 22, declineAge: 23, cliffAge: 24, depreciationRate: 0.50 },
    { position: 'RB', peakAge: 21, declineAge: 22, cliffAge: 23, depreciationRate: 0.50 },
    { position: 'WR', peakAge: 22, declineAge: 23, cliffAge: 24, depreciationRate: 0.50 },
    { position: 'TE', peakAge: 22, declineAge: 23, cliffAge: 24, depreciationRate: 0.50 },
  ],
  volatility: [
    { position: 'QB', baseVolatility: 0.20, consistencyWeight: 0.3 },
    { position: 'RB', baseVolatility: 0.28, consistencyWeight: 0.4 },
    { position: 'WR', baseVolatility: 0.22, consistencyWeight: 0.3 },
    { position: 'TE', baseVolatility: 0.24, consistencyWeight: 0.3 },
  ],
  scoringFormats: [
    {
      format: 'PPR',
      positionMultipliers: { QB: 1.15, RB: 0.95, WR: 1.05, TE: 0.90, K: 1.0, DEF: 1.0 },
      scaleFactor: 0.65,
    },
  ],
}

const NCAAB_TUNING: SportTuning = {
  sport: 'NCAAB',
  displayName: 'College Fantasy Basketball',
  seasonWeeks: 18,
  typicalStarters: 8,
  defaultScoreStdDev: 16,
  maxCareerYears: 4,
  consistencyBoost: false,
  scarcity: [
    { position: 'PG', multiplier: 1.10, replacementThreshold: 1200 },
    { position: 'SG', multiplier: 0.95, replacementThreshold: 1000 },
    { position: 'SF', multiplier: 1.0, replacementThreshold: 1000 },
    { position: 'PF', multiplier: 1.0, replacementThreshold: 1000 },
    { position: 'C', multiplier: 1.10, replacementThreshold: 1200 },
  ],
  ageCurves: [
    { position: 'PG', peakAge: 22, declineAge: 23, cliffAge: 24, depreciationRate: 0.50 },
    { position: 'SG', peakAge: 22, declineAge: 23, cliffAge: 24, depreciationRate: 0.50 },
    { position: 'SF', peakAge: 22, declineAge: 23, cliffAge: 24, depreciationRate: 0.50 },
    { position: 'PF', peakAge: 22, declineAge: 23, cliffAge: 24, depreciationRate: 0.50 },
    { position: 'C', peakAge: 22, declineAge: 23, cliffAge: 24, depreciationRate: 0.50 },
  ],
  volatility: [
    { position: 'PG', baseVolatility: 0.20, consistencyWeight: 0.3 },
    { position: 'SG', baseVolatility: 0.22, consistencyWeight: 0.3 },
    { position: 'SF', baseVolatility: 0.20, consistencyWeight: 0.3 },
    { position: 'PF', baseVolatility: 0.22, consistencyWeight: 0.3 },
    { position: 'C', baseVolatility: 0.18, consistencyWeight: 0.4 },
  ],
  scoringFormats: [
    {
      format: 'Points',
      positionMultipliers: { PG: 1.05, SG: 1.0, SF: 1.0, PF: 1.0, C: 1.05 },
      scaleFactor: 0.60,
    },
  ],
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

const SPORT_REGISTRY: Record<SupportedSport, SportTuning> = {
  NFL: NFL_TUNING,
  NBA: NBA_TUNING,
  MLB: MLB_TUNING,
  NHL: NHL_TUNING,
  NCAAF: NCAAF_TUNING,
  NCAAB: NCAAB_TUNING,
  SOCCER: SOCCER_TUNING,
}

/**
 * Get tuning config for a sport. Falls back to NFL if unknown.
 */
export function getSportTuning(sport: string): SportTuning {
  const key = sport.toUpperCase() as SupportedSport
  return SPORT_REGISTRY[key] ?? SPORT_REGISTRY.NFL
}

/**
 * Get all supported sports.
 */
export function getSupportedSports(): SupportedSport[] {
  return Object.keys(SPORT_REGISTRY) as SupportedSport[]
}

// ---------------------------------------------------------------------------
// Sport-Aware Helpers
// ---------------------------------------------------------------------------

/**
 * Get the scarcity multiplier for a position in a given sport.
 * Handles SF/TEP variants for NFL.
 */
export function getScarcityMultiplier(
  sport: string,
  position: string,
  options?: { isSF?: boolean; isTEP?: boolean },
): number {
  const tuning = getSportTuning(sport)

  // NFL special cases
  if (tuning.sport === 'NFL') {
    if (position === 'QB' && options?.isSF) {
      return tuning.scarcity.find(s => s.position === 'QB_SF')?.multiplier ?? 1.3
    }
    if (position === 'TE' && options?.isTEP) {
      return tuning.scarcity.find(s => s.position === 'TE_TEP')?.multiplier ?? 1.2
    }
  }

  const entry = tuning.scarcity.find(s => s.position === position.toUpperCase())
  return entry?.multiplier ?? 0.9
}

/**
 * Get the age curve for a position in a given sport.
 */
export function getAgeCurve(sport: string, position: string): AgeCurve | null {
  const tuning = getSportTuning(sport)
  return tuning.ageCurves.find(c => c.position === position.toUpperCase()) ?? null
}

/**
 * Compute age-based value multiplier (0.3 - 1.0).
 */
export function computeAgeMultiplier(sport: string, position: string, age: number): number {
  const curve = getAgeCurve(sport, position)
  if (!curve) return 1.0

  if (age <= curve.peakAge) return 1.0
  if (age <= curve.declineAge) {
    // Gradual decline
    const yearsPostPeak = age - curve.peakAge
    return Math.max(0.7, 1.0 - yearsPostPeak * curve.depreciationRate * 0.5)
  }
  if (age <= curve.cliffAge) {
    // Steeper decline
    const yearsPastDecline = age - curve.declineAge
    const baseDecline = (curve.declineAge - curve.peakAge) * curve.depreciationRate * 0.5
    return Math.max(0.4, 1.0 - baseDecline - yearsPastDecline * curve.depreciationRate)
  }
  // Past cliff — fire sale
  return Math.max(0.3, 0.4 - (age - curve.cliffAge) * curve.depreciationRate)
}

/**
 * Get the volatility profile for a position in a given sport.
 */
export function getVolatilityProfile(sport: string, position: string): VolatilityProfile {
  const tuning = getSportTuning(sport)
  return (
    tuning.volatility.find(v => v.position === position.toUpperCase()) ?? {
      position: position.toUpperCase(),
      baseVolatility: 0.20,
      consistencyWeight: 0.3,
    }
  )
}

/**
 * Get scoring format normalization for a sport + format combo.
 */
export function getScoringNormalization(
  sport: string,
  format: string,
): ScoringNormalization | null {
  const tuning = getSportTuning(sport)
  return (
    tuning.scoringFormats.find(
      f => f.format.toLowerCase() === format.toLowerCase(),
    ) ?? tuning.scoringFormats[0] ?? null
  )
}

/**
 * Normalize a player value to the unified 0-10000 scale.
 * Applies sport-specific scale factor and scoring format multipliers.
 */
export function normalizeValueForSport(
  rawValue: number,
  sport: string,
  position: string,
  scoringFormat?: string,
): number {
  const tuning = getSportTuning(sport)
  const norm = scoringFormat
    ? getScoringNormalization(sport, scoringFormat)
    : tuning.scoringFormats[0]

  if (!norm) return rawValue

  const posMult = norm.positionMultipliers[position.toUpperCase()] ?? 1.0
  const scaled = rawValue * posMult * norm.scaleFactor

  // Apply consistency boost for low-scoring sports (soccer)
  if (tuning.consistencyBoost) {
    // Consistency boost: reduce volatility penalty, reward floor players
    const volProfile = getVolatilityProfile(sport, position)
    const consistencyFactor = 1 + volProfile.consistencyWeight * 0.1
    return Math.round(scaled * consistencyFactor)
  }

  return Math.round(scaled)
}

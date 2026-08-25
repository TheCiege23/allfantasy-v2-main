/**
 * lib/engine/utv.ts
 * Universal Trade Value (UTV) — sport-normalized 0–1000 scale.
 * Continuously updated from trade history across the app + market data.
 * Stores rolling averages per player/pick. Precomputed nightly, cached at runtime.
 *
 * Performance target: <5ms per lookup, <50ms for batch of 20 players.
 */

import type { SportKey } from './trade-types'
import { pickRoundTable } from '@/lib/pick-curve'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface UTVEntry {
  playerId: string
  name: string
  sport: SportKey
  position: string
  utv: number // 0–1000
  marketValue: number
  tradeVolume: number // how many times traded in last 90 days
  lastTradeDate: string | null
  trend: 'rising' | 'falling' | 'stable'
  trendDelta: number // change in last 14 days (-100 to +100)
  updatedAt: string
}

export interface UTVPickEntry {
  sport: SportKey
  year: number
  round: number
  tier: 'early' | 'mid' | 'late'
  utv: number
}

// ---------------------------------------------------------------------------
// Sport normalization constants — different sports have different value ceilings
// ---------------------------------------------------------------------------

const SPORT_VALUE_CEILING: Record<string, number> = {
  NFL: 10000,
  NBA: 8500,
  MLB: 7500,
  NHL: 7000,
  NCAAF: 5500,
  NCAAB: 5000,
  SOCCER: 8000,
  GOLF: 4000,
  NASCAR: 3500,
  CUSTOM: 6000,
}

const SPORT_POSITION_WEIGHTS: Record<string, Record<string, number>> = {
  NFL: { QB: 1.0, RB: 0.85, WR: 0.90, TE: 0.65, K: 0.15, DEF: 0.20, DL: 0.35, LB: 0.40, DB: 0.35 },
  NBA: { PG: 0.90, SG: 0.85, SF: 0.90, PF: 0.85, C: 0.80 },
  MLB: { SP: 0.95, RP: 0.55, C: 0.60, '1B': 0.70, '2B': 0.70, SS: 0.80, '3B': 0.75, OF: 0.80, DH: 0.55 },
  NHL: { C: 0.90, LW: 0.80, RW: 0.80, D: 0.75, G: 0.70 },
  NCAAF: { QB: 1.0, RB: 0.80, WR: 0.85, TE: 0.55 },
  NCAAB: { PG: 0.90, SG: 0.85, SF: 0.85, PF: 0.80, C: 0.75 },
  SOCCER: { FW: 0.95, MF: 0.85, DF: 0.65, GK: 0.50 },
}

// ---------------------------------------------------------------------------
// In-memory cache (precomputed nightly, refreshed on demand)
// ---------------------------------------------------------------------------

let _utvCache: Map<string, UTVEntry> = new Map()
let _utvPickCache: Map<string, UTVPickEntry> = new Map()
let _cacheTimestamp = 0
const CACHE_TTL_MS = 15 * 60 * 1000 // 15 minutes

// ---------------------------------------------------------------------------
// Core UTV computation
// ---------------------------------------------------------------------------

/**
 * Normalize a raw market value to the 0–1000 UTV scale for a given sport.
 */
export function normalizeToUTV(
  rawValue: number,
  sport: SportKey,
  position: string,
): number {
  const ceiling = SPORT_VALUE_CEILING[sport] ?? 6000
  const posWeights = SPORT_POSITION_WEIGHTS[sport] ?? {}
  const posWeight = posWeights[position] ?? 0.75

  // Logarithmic normalization to compress high values and expand low values
  // This prevents elite players from dominating the scale
  const logNormalized = Math.log1p(rawValue) / Math.log1p(ceiling)
  const scaled = logNormalized * 1000 * posWeight

  return Math.round(Math.max(0, Math.min(1000, scaled)))
}

/**
 * Compute UTV from multiple value signals.
 */
export function computeUTV(inputs: {
  marketValue: number
  internalTradeValue: number | null // from app-wide trade history
  fantasyCalcValue: number | null
  sport: SportKey
  position: string
  tradeVolume: number // number of trades in last 90 days
}): number {
  const { marketValue, internalTradeValue, fantasyCalcValue, sport, position, tradeVolume } = inputs

  // Weighted blend of available signals
  let blendedValue = 0
  let totalWeight = 0

  // Market value always available (weight: 0.40)
  blendedValue += marketValue * 0.40
  totalWeight += 0.40

  // FantasyCalc value (weight: 0.35 if available)
  if (fantasyCalcValue != null && fantasyCalcValue > 0) {
    blendedValue += fantasyCalcValue * 0.35
    totalWeight += 0.35
  }

  // Internal trade history value (weight: 0.25 if available, boosted by volume)
  if (internalTradeValue != null && internalTradeValue > 0 && tradeVolume >= 2) {
    const volumeBoost = Math.min(1.0, tradeVolume / 10) // higher volume = more weight
    const weight = 0.25 * volumeBoost
    blendedValue += internalTradeValue * weight
    totalWeight += weight
  }

  // Normalize to account for available signals
  const normalized = totalWeight > 0 ? blendedValue / totalWeight : marketValue

  return normalizeToUTV(normalized, sport, position)
}

/**
 * Compute trend direction from recent value history.
 */
export function computeTrend(
  currentUtv: number,
  previousUtv: number | null,
  daysDelta: number = 14,
): { trend: 'rising' | 'falling' | 'stable'; trendDelta: number } {
  if (previousUtv == null) return { trend: 'stable', trendDelta: 0 }

  const delta = currentUtv - previousUtv
  const pctChange = previousUtv > 0 ? (delta / previousUtv) * 100 : 0

  if (pctChange > 3) return { trend: 'rising', trendDelta: Math.round(delta) }
  if (pctChange < -3) return { trend: 'falling', trendDelta: Math.round(delta) }
  return { trend: 'stable', trendDelta: Math.round(delta) }
}

// ---------------------------------------------------------------------------
// Pick UTV
// ---------------------------------------------------------------------------

/**
 * Compute UTV for a draft pick.
 */
export function computePickUTV(inputs: {
  year: number
  round: number
  tier: 'early' | 'mid' | 'late'
  sport: SportKey
  format: 'dynasty' | 'redraft' | 'keeper'
  currentYear: number
  classStrength?: number // 0–100, how strong the incoming class is
}): number {
  const { year, round, tier, sport, format, currentYear, classStrength = 50 } = inputs

  // Base pick values by round (dynasty scale)
  /*
   * ⚠ SHAPE NOW SHARED. Paid 0.60 of a first for a second against the canonical 0.48. The
   * 750-point anchor is this module's own scale; see lib/pick-curve.ts for the shape.
   */
  const BASE_PICK_VALUES: Record<number, number> = pickRoundTable(750)
  let base = BASE_PICK_VALUES[round] ?? Math.max(20, 800 - round * 150)

  // Tier adjustment within round
  const tierMult = tier === 'early' ? 1.25 : tier === 'late' ? 0.75 : 1.0
  base *= tierMult

  // Year decay — future picks lose value
  const yearsOut = Math.max(0, year - currentYear)
  const yearDecay = Math.pow(0.88, yearsOut) // ~12% decay per year
  base *= yearDecay

  // Class strength adjustment (±15%)
  const classAdj = 1.0 + ((classStrength - 50) / 50) * 0.15
  base *= classAdj

  // Format adjustment — picks worth less in redraft
  if (format === 'redraft') base *= 0.30
  else if (format === 'keeper') base *= 0.65

  // Sport normalization
  const ceiling = SPORT_VALUE_CEILING[sport] ?? 6000
  const sportAdj = ceiling / 10000 // NFL = 1.0, others scale down
  base *= sportAdj

  return Math.round(Math.max(0, Math.min(1000, base)))
}

// ---------------------------------------------------------------------------
// Cache management
// ---------------------------------------------------------------------------

/**
 * Get cached UTV for a player. Returns null if not cached.
 */
export function getCachedUTV(playerId: string): UTVEntry | null {
  if (Date.now() - _cacheTimestamp > CACHE_TTL_MS) return null
  return _utvCache.get(playerId) ?? null
}

/**
 * Set UTV in cache.
 */
export function setCachedUTV(entry: UTVEntry): void {
  _utvCache.set(entry.playerId, entry)
  _cacheTimestamp = Date.now()
}

/**
 * Bulk set UTV entries (for nightly precompute).
 */
export function bulkSetUTV(entries: UTVEntry[]): void {
  _utvCache = new Map(entries.map(e => [e.playerId, e]))
  _cacheTimestamp = Date.now()
}

/**
 * Get all cached UTV entries for a sport.
 */
export function getUTVBySport(sport: SportKey): UTVEntry[] {
  const result: UTVEntry[] = []
  for (const entry of _utvCache.values()) {
    if (entry.sport === sport) result.push(entry)
  }
  return result
}

// ---------------------------------------------------------------------------
// Exports for trade engine integration
// ---------------------------------------------------------------------------

export { SPORT_VALUE_CEILING, SPORT_POSITION_WEIGHTS }

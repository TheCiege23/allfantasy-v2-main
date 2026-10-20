/**
 * AgingCurveService — aging curve impact on player value over horizon (next / 3-year / 5-year).
 * Sport-aware via SportDynastyResolver.
 */

import { getPeakAgeRange, isCollegeDynastySport } from './SportDynastyResolver'

export type Horizon = 'next' | 'three' | 'five'

/**
 * Multiplier for dynasty value at a given horizon (0–1+). Age and position drive decline.
 */
export function ageMultiplier(
  sport: string,
  position: string,
  age: number | null,
  horizon: Horizon
): number {
  if (!age || age <= 0) return 1
  // NCAAF / NCAAB: no age effect at any horizon — players leave college before any decline, and
  // eligibility (not age) is what ends their value. See COLLEGE_DYNASTY_SPORTS.
  if (isCollegeDynastySport(sport)) return 1
  const cfg = getPeakAgeRange(sport, position)
  const horizonOffset: Record<Horizon, number> = {
    next: 0,
    three: 2,
    five: 4,
  }
  const effAge = age + horizonOffset[horizon]

  if (effAge < cfg.peakStart - 2) {
    return 0.85 + (effAge / (cfg.peakStart - 2)) * 0.15
  }
  if (effAge <= cfg.peakEnd) return 1.0
  if (effAge >= cfg.hardCliff) return 0.4
  const t = (effAge - cfg.peakEnd) / (cfg.hardCliff - cfg.peakEnd)
  return 1.0 - t * 0.6
}

/**
 * Aggregate aging risk score (0–100) from roster: higher = more age-related decline risk.
 */
export function rosterAgingRiskScore(
  sport: string,
  players: { position: string; age: number | null; dynastyValue: number }[]
): number {
  if (!players.length) return 0
  let riskSum = 0
  let totalValue = 0
  for (const p of players) {
    const base = Math.max(0, p.dynastyValue)
    totalValue += base
    const mNext = ageMultiplier(sport, p.position, p.age ?? null, 'next')
    const mFive = ageMultiplier(sport, p.position, p.age ?? null, 'five')
    const decline = 1 - mFive
    riskSum += base * decline
  }
  if (totalValue <= 0) return 0
  return Math.round(Math.min(100, (riskSum / totalValue) * 150))
}

import { ageMultiplier as sportAgeMultiplier } from '@/lib/dynasty-engine/AgingCurveService'
import { getPeakAgeRange, hasNativeAgingCurve, isCollegeDynastySport } from '@/lib/dynasty-engine/SportDynastyResolver'
import type {
  PlayerDynastyAsset,
  DynastyLeagueContext,
  RosterFutureValueBreakdown,
} from './types'

type Horizon = 'next' | 'three' | 'five'

/**
 * NFL-shaped curve. This is the historical behaviour and still what NFL (and the sports without a
 * native curve) run, byte-for-byte — note it deliberately differs from getPeakAgeRange for K/DEF.
 */
function nflAgeMultiplier(position: string, age: number | null, horizon: Horizon): number {
  if (!age || age <= 0) return 1
  const pos = position.toUpperCase()

  const targetAge: Record<string, { peakStart: number; peakEnd: number; hardCliff: number }> = {
    QB: { peakStart: 27, peakEnd: 33, hardCliff: 38 },
    RB: { peakStart: 23, peakEnd: 26, hardCliff: 29 },
    WR: { peakStart: 25, peakEnd: 30, hardCliff: 33 },
    TE: { peakStart: 26, peakEnd: 30, hardCliff: 33 },
  }
  const cfg = targetAge[pos] ?? { peakStart: 25, peakEnd: 29, hardCliff: 32 }

  const horizonOffset: Record<Horizon, number> = {
    next: 0,
    three: 2,
    five: 4,
  }

  const effAge = age + horizonOffset[horizon]

  if (effAge < cfg.peakStart - 2) {
    return 0.85 + (effAge / (cfg.peakStart - 2)) * 0.15
  }
  if (effAge <= cfg.peakEnd) {
    return 1.0
  }
  if (effAge >= cfg.hardCliff) {
    return 0.4
  }

  const t = (effAge - cfg.peakEnd) / (cfg.hardCliff - cfg.peakEnd)
  return 1.0 - t * 0.6
}

/**
 * MLB / NBA / NHL used to run the NFL curve above, so an NHL goalie fell to the 25/29/32 default and
 * an MLB SP aged like an NFL WR. They now go through the sport-aware AgingCurveService.
 */
function ageMultiplier(sport: string, position: string, age: number | null, horizon: Horizon): number {
  // NCAAF / NCAAB used to run the NFL curve: a 23-year-old college RB "declined" at the five-year
  // horizon (age 27 on the NFL RB curve) and 18-19-year-olds took the NFL pre-peak discount. College
  // value is not age-driven, so the multiplier is flat (see COLLEGE_DYNASTY_SPORTS).
  if (isCollegeDynastySport(sport)) return 1
  if (hasNativeAgingCurve(sport)) return sportAgeMultiplier(sport, position, age, horizon)
  return nflAgeMultiplier(position, age, horizon)
}

/**
 * Per-player age risk (0-100ish). NFL keeps its hand-tuned position slopes. Native-curve sports
 * previously scored 0 for every position (only QB/RB/WR/TE matched), so their agingRiskScore was
 * always 0; they now accrue risk from one year before peakEnd, scaled so reaching the cliff costs
 * ~8 points per year of decline window regardless of how long that window is.
 */
function ageRiskFor(sport: string, position: string, age: number): number {
  const pos = position.toUpperCase()
  if (isCollegeDynastySport(sport)) return 0
  if (hasNativeAgingCurve(sport)) {
    const r = getPeakAgeRange(sport, pos)
    const span = Math.max(1, r.hardCliff - r.peakEnd)
    return Math.max(0, age - (r.peakEnd - 1)) * (8 / span)
  }
  if (pos === 'RB') return Math.max(0, age - 25) * 4
  if (pos === 'WR') return Math.max(0, age - 28) * 2.5
  if (pos === 'TE') return Math.max(0, age - 28) * 2
  if (pos === 'QB') return Math.max(0, age - 33) * 1.5
  return 0
}

function positionScarcityMultiplier(position: string, ctx: DynastyLeagueContext): number {
  const pos = position.toUpperCase()
  if (pos === 'QB') return ctx.isSuperFlex ? 1.3 : 1.0
  if (pos === 'TE') return ctx.isTightEndPremium ? 1.15 : 1.0
  return 1.0
}

export function calculateRosterFutureValue(
  players: PlayerDynastyAsset[],
  ctx: DynastyLeagueContext,
): RosterFutureValueBreakdown {
  if (!players.length) {
    return {
      nextYearStrength: 0,
      threeYearStrength: 0,
      fiveYearStrength: 0,
      agingRiskScore: 0,
      injuryRiskScore: 0,
    }
  }

  let nextSum = 0
  let threeSum = 0
  let fiveSum = 0
  let ageWeighted = 0
  let injuryWeighted = 0
  let totalDynasty = 0

  for (const p of players) {
    const base = Math.max(0, p.dynastyValue)
    if (!base) continue
    const scarcity = positionScarcityMultiplier(p.position, ctx)

    const mNext = ageMultiplier(ctx.sport, p.position, p.age ?? null, 'next') * scarcity
    const mThree = ageMultiplier(ctx.sport, p.position, p.age ?? null, 'three') * scarcity
    const mFive = ageMultiplier(ctx.sport, p.position, p.age ?? null, 'five') * scarcity

    nextSum += base * mNext
    threeSum += base * mThree
    fiveSum += base * mFive

    const ageForRisk = p.age ?? 26
    const ageRisk = ageRiskFor(ctx.sport, p.position, ageForRisk)

    const injuryScore = p.recentInjuryScore ?? 0

    ageWeighted += ageRisk * base
    injuryWeighted += injuryScore * base
    totalDynasty += base
  }

  const normalize = (v: number) => Math.round(v)
  const agingRiskScore =
    totalDynasty > 0 ? Math.min(100, Math.max(0, (ageWeighted / totalDynasty))) : 0
  const injuryRiskScore =
    totalDynasty > 0 ? Math.min(100, Math.max(0, (injuryWeighted / totalDynasty))) : 0

  return {
    nextYearStrength: normalize(nextSum),
    threeYearStrength: normalize(threeSum),
    fiveYearStrength: normalize(fiveSum),
    agingRiskScore,
    injuryRiskScore,
  }
}


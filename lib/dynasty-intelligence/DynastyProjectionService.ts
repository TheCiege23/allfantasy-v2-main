/**
 * Dynasty Intelligence Engine (PROMPT 137).
 * Calculates: age curve, market value trend, career trajectory.
 * Adds deterministic dynasty valuation overlays for lifecycle, risk, and recommendations.
 */
import {
  findPlayerTier,
  getAgeCurveWithCliffs,
  getExpectedWindow,
  getWindowMultiplier,
  TIER_BASE_VALUES,
} from '@/lib/dynasty-tiers'
import { getPeakAgeRange, isCollegeDynastySport } from '@/lib/dynasty-engine/SportDynastyResolver'
import { prisma } from '@/lib/prisma'
import { normalizeToSupportedSport, SUPPORTED_SPORTS } from '@/lib/sport-scope'
import type {
  AgeCurvePoint,
  AgeCurveResult,
  CareerTrajectoryPoint,
  CareerTrajectoryResult,
  DynastyIntelligenceOptions,
  DynastyLifecycleStage,
  DynastyMarketDirection,
  DynastyOverviewCard,
  DynastyRecommendation,
  DynastyTrajectoryLabel,
  DynastyValuationBand,
  DynastyValuationBreakdown,
  MarketTrendFactor,
  MarketValueTrend,
  PlayerDynastyIntelligence,
} from './types'

const AGE_RANGE = { min: 18, max: 42 }

const DEFAULT_POSITION_BY_SPORT: Record<string, string> = {
  NFL: 'WR',
  NHL: 'C',
  NBA: 'SF',
  MLB: 'OF',
  NCAAB: 'SG',
  NCAAF: 'WR',
  SOCCER: 'MID',
}

const POSITION_ALIASES: Record<string, Record<string, string>> = {
  NFL: { HB: 'RB', FB: 'RB', PK: 'K', DEF: 'DST', D: 'DST' },
  NCAAF: { HB: 'RB', FB: 'RB', PK: 'K', DEF: 'DST', D: 'DST' },
  NBA: { G: 'PG', F: 'SF', UTIL: 'SF' },
  NCAAB: { G: 'PG', F: 'SF', UTIL: 'SF' },
  MLB: { SP: 'SP', RP: 'RP', P: 'SP', DH: 'OF', LF: 'OF', CF: 'OF', RF: 'OF' },
  NHL: { W: 'LW', F: 'C', LD: 'D', RD: 'D' },
  SOCCER: { GK: 'GK', GKP: 'GK', G: 'GK', F: 'FWD', FW: 'FWD', ST: 'FWD', M: 'MID', MF: 'MID', D: 'DEF', DF: 'DEF' },
}

const POSITION_BASE_VALUES_BY_SPORT: Record<string, Record<string, number>> = {
  NFL: { QB: 5400, RB: 4700, WR: 5000, TE: 4100, K: 2600, DST: 2300 },
  NCAAF: { QB: 5100, RB: 4550, WR: 4800, TE: 3900, K: 2400, DST: 2200 },
  NBA: { PG: 5000, SG: 4750, SF: 4900, PF: 4700, C: 4600 },
  NCAAB: { PG: 4700, SG: 4550, SF: 4650, PF: 4500, C: 4400 },
  NHL: { C: 4700, LW: 4450, RW: 4450, D: 4200, G: 4850 },
  MLB: { SP: 4550, RP: 3550, C: 3200, '1B': 3950, '2B': 3850, '3B': 3980, SS: 4150, OF: 4050 },
  SOCCER: { FWD: 4700, MID: 4550, DEF: 3950, GK: 3600 },
}

const GENERIC_POSITION_MULTIPLIERS: Record<string, Record<string, number>> = {
  NFL: { QB: 1.6, WR: 1.14, TE: 1.12, RB: 0.94, K: 0.78, DST: 0.72 },
  NCAAF: { QB: 1.45, WR: 1.1, TE: 1.02, RB: 0.98, K: 0.76, DST: 0.74 },
  NBA: { PG: 1.12, SG: 1.05, SF: 1.08, PF: 1.03, C: 1.01 },
  NCAAB: { PG: 1.08, SG: 1.04, SF: 1.05, PF: 1.01, C: 0.99 },
  NHL: { C: 1.08, LW: 1.01, RW: 1.01, D: 0.96, G: 1.12 },
  MLB: { SP: 1.08, RP: 0.88, C: 0.9, '1B': 0.98, '2B': 1.01, '3B': 1.03, SS: 1.06, OF: 1.0 },
  SOCCER: { FWD: 1.08, MID: 1.03, DEF: 0.94, GK: 0.9 },
}

type PlayerMetaTrendRow = {
  trendScore: number
  previousTrendScore: number | null
  addRate: number
  dropRate: number
  tradeInterest: number
  draftFrequency: number
  lineupStartRate: number
  injuryImpact: number
  trendingDirection: string
  updatedAt: Date
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function roundTo(value: number, digits: number = 2): number {
  return Number(value.toFixed(digits))
}

function normalizePosition(sport: string, position?: string | null): string {
  const fallback = DEFAULT_POSITION_BY_SPORT[sport] ?? DEFAULT_POSITION_BY_SPORT.NFL
  if (!position) return fallback
  const cleaned = position.trim().toUpperCase()
  if (!cleaned) return fallback
  return POSITION_ALIASES[sport]?.[cleaned] ?? cleaned
}

function resolveArchetypePosition(sport: string, position: string): string | null {
  const normalized = normalizePosition(sport, position)
  if (sport === 'NFL' || sport === 'NCAAF') {
    if (['QB', 'RB', 'WR', 'TE'].includes(normalized)) return normalized
  }
  // MLB / NBA / NHL used to be mapped onto NFL archetypes here (NBA PG & MLB SP -> QB curve,
  // NHL wingers -> WR curve, MLB C -> TE curve), which then applied NFL cliffs and the NFL
  // superflex/TE-premium multipliers to them. They now return null so every caller falls through
  // to the sport's own per-position range from getPeakAgeRange. SOCCER joined them (GK used to run
  // the NFL QB curve and take the superflex x1.6; DEF the TE curve and the TE-premium bump), and
  // NCAAB returns null too (its PG/SG were NFL QBs for the superflex multiplier). NCAAF keeps the NFL
  // archetypes for POSITION value only — superflex / TE premium are real college-football settings —
  // while its age handling is flat (see getSportAwareAgeMultiplier).
  return null
}

function getSportAwareAgeMultiplier(sport: string, position: string, age: number | null): number {
  if (age == null) return 1
  // NCAAF / NCAAB: no age effect (players leave college before any decline; eligibility, which these
  // inputs do not carry, is what ends their value). See COLLEGE_DYNASTY_SPORTS.
  if (isCollegeDynastySport(sport)) return 1
  const archetype = resolveArchetypePosition(sport, position)
  if (archetype) {
    return roundTo(getAgeCurveWithCliffs(archetype, age), 2)
  }

  const range = getPeakAgeRange(sport, position)
  if (age < range.peakStart) {
    const seasonsToPeak = range.peakStart - age
    return roundTo(clamp(1.08 - seasonsToPeak * 0.03, 0.82, 1.08), 2)
  }
  if (age <= range.peakEnd) return 1

  const declineSpan = Math.max(1, range.hardCliff - range.peakEnd)
  const yearsPastPeak = age - range.peakEnd
  const softDecline = yearsPastPeak * (0.3 / declineSpan)
  const cliffDecline = age > range.hardCliff ? (age - range.hardCliff) * 0.08 : 0
  return roundTo(clamp(1 - softDecline - cliffDecline, 0.55, 1), 2)
}

function getSportAwareExpectedWindow(sport: string, position: string, age: number | null): number {
  if (age == null) return 5
  // College: the remaining window is eligibility (class year), not age, and it is not an input here,
  // so age is treated as uninformative — the same 5 an unknown age gets — rather than reading an NFL
  // career length (a 20-year-old QB used to get a 12-year window) into a college roster.
  if (isCollegeDynastySport(sport)) return 5
  const archetype = resolveArchetypePosition(sport, position)
  if (archetype) {
    return roundTo(getExpectedWindow(archetype, age), 1)
  }

  const range = getPeakAgeRange(sport, position)
  const yearsToCliff = Math.max(0.5, range.hardCliff - age)
  const runwayBonus = age < range.peakStart ? Math.min(2.5, (range.peakStart - age) * 0.35) : 0
  return roundTo(clamp(yearsToCliff + runwayBonus, 1, 10), 1)
}

function getSportAwarePositionMultiplier(
  sport: string,
  position: string,
  isSuperFlex: boolean,
  isTightEndPremium: boolean
): number {
  const normalized = normalizePosition(sport, position)
  const archetype = resolveArchetypePosition(sport, normalized)
  if (archetype === 'QB') return roundTo(isSuperFlex ? 1.6 : 0.95, 2)
  if (archetype === 'TE') return roundTo(isTightEndPremium ? 1.28 : 1.12, 2)
  if (archetype === 'WR') return roundTo(GENERIC_POSITION_MULTIPLIERS[sport]?.[normalized] ?? 1.08, 2)
  if (archetype === 'RB') return roundTo(GENERIC_POSITION_MULTIPLIERS[sport]?.[normalized] ?? 0.96, 2)
  return roundTo(GENERIC_POSITION_MULTIPLIERS[sport]?.[normalized] ?? 1, 2)
}

export function classifyDynastyLifecycleStage(args: {
  age: number | null
  peakAgeStart: number
  peakAgeEnd: number
  cliffAge: number
}): DynastyLifecycleStage {
  const { age, peakAgeStart, peakAgeEnd, cliffAge } = args
  if (age == null) return 'Prime'
  if (age <= peakAgeStart - 2) return 'Prospect'
  if (age < peakAgeStart) return 'Ascendant'
  if (age <= peakAgeEnd) return 'Prime'
  if (age <= Math.max(peakAgeEnd + 1, cliffAge - 2)) return 'Plateau'
  if (age < cliffAge) return 'Decline'
  return 'Cliff Risk'
}

function getRiskBand(args: {
  currentAge: number | null
  currentMultiplier: number | null
  yearsToCliff: number | null
}): 'Low' | 'Moderate' | 'High' {
  if (args.currentAge == null || args.currentMultiplier == null || args.yearsToCliff == null) {
    return 'Moderate'
  }
  if (args.currentMultiplier >= 0.98 && args.yearsToCliff >= 4) return 'Low'
  if (args.currentMultiplier >= 0.85 && args.yearsToCliff >= 2) return 'Moderate'
  return 'High'
}

function normalizeMarketDirection(
  rawDirection: string | null | undefined,
  trendScore: number,
  scoreDelta: number | null
): DynastyMarketDirection {
  const normalized = rawDirection?.trim().toUpperCase()
  if (normalized === 'HOT') return 'Hot'
  if (normalized === 'RISING' || normalized === 'UP') return 'Rising'
  if (normalized === 'FALLING' || normalized === 'DOWN') return 'Falling'
  if (normalized === 'COLD') return 'Cold'
  if (normalized === 'STABLE' || normalized === 'EVEN') return 'Stable'

  if (trendScore >= 72 && (scoreDelta ?? 0) >= 4) return 'Hot'
  if ((scoreDelta ?? 0) >= 1.5 || trendScore >= 60) return 'Rising'
  if (trendScore <= 30 || (scoreDelta ?? 0) <= -4) return 'Cold'
  if ((scoreDelta ?? 0) <= -1.5) return 'Falling'
  return 'Stable'
}

function buildSignalLabel(direction: DynastyMarketDirection): string {
  if (direction === 'Hot') return 'Market is chasing the ceiling'
  if (direction === 'Rising') return 'Value is climbing'
  if (direction === 'Falling') return 'Managers are discounting the asset'
  if (direction === 'Cold') return 'Trade appetite is fading fast'
  return 'Market is holding a steady line'
}

function inferBaseValue(args: {
  sport: string
  position: string
  age: number | null
  explicitBaseValue?: number
  displayName?: string | null
  trendRow?: PlayerMetaTrendRow | null
}): number {
  if (
    typeof args.explicitBaseValue === 'number' &&
    Number.isFinite(args.explicitBaseValue) &&
    args.explicitBaseValue > 0
  ) {
    return roundTo(args.explicitBaseValue, 0)
  }

  const baseline = POSITION_BASE_VALUES_BY_SPORT[args.sport]?.[args.position] ?? 4200
  const tier = args.displayName ? findPlayerTier(args.displayName, args.position) : null
  if (tier) {
    return roundTo(TIER_BASE_VALUES[tier.tier] * 8, 0)
  }

  if (args.trendRow) {
    const trendScaled = args.trendRow.trendScore * 100
    return roundTo(clamp(trendScaled, 2400, 9200), 0)
  }

  const ageMultiplier = getSportAwareAgeMultiplier(args.sport, args.position, args.age)
  return roundTo(baseline * (0.92 + ageMultiplier * 0.18), 0)
}

function buildMarketSignals(args: {
  ageCurve: AgeCurveResult
  tradeInterest: number
  lineupStartRate: number
  injuryImpact: number
  scoreDelta: number | null
  direction: DynastyMarketDirection
}): string[] {
  const signals: string[] = []
  if (args.tradeInterest >= 0.18) {
    signals.push(`Trade chatter is elevated at ${roundTo(args.tradeInterest * 100, 0)}% strength.`)
  }
  if (args.lineupStartRate >= 0.7) {
    signals.push(`Lineup stickiness is strong with a ${roundTo(args.lineupStartRate * 100, 0)}% start rate.`)
  }
  if ((args.scoreDelta ?? 0) >= 3) {
    signals.push(`Trend score jumped ${roundTo(args.scoreDelta ?? 0, 1)} points since the prior snapshot.`)
  }
  if (args.injuryImpact >= 0.18) {
    signals.push(`Injury drag is non-trivial and raises short-term pricing volatility.`)
  }
  if (args.ageCurve.yearsToCliff != null && args.ageCurve.yearsToCliff <= 2) {
    signals.push(
      `The age curve is approaching the cliff window within ${roundTo(args.ageCurve.yearsToCliff, 1)} years.`
    )
  }
  if (signals.length === 0) {
    signals.push(`${buildSignalLabel(args.direction)} with balanced demand and age-curve support.`)
  }
  return signals.slice(0, 4)
}

export function buildDeterministicMarketValueTrend(args: {
  sport: string
  position: string
  age: number | null
  currentValue: number
  row?: PlayerMetaTrendRow | null
  ageCurve?: AgeCurveResult | null
}): MarketValueTrend {
  const ageCurve = args.ageCurve ?? getAgeCurve(args.sport, args.position, args.age)
  const peakRange = getPeakAgeRange(args.sport, args.position)
  const youthBias =
    args.age == null
      ? 0
      : args.age < peakRange.peakStart
        ? 6
        : args.age <= peakRange.peakEnd
          ? 2
          : -6

  const addRate = args.row?.addRate ?? roundTo(clamp(0.1 + (youthBias > 0 ? 0.06 : 0) - (youthBias < 0 ? 0.03 : 0), 0.02, 0.28), 2)
  const dropRate = args.row?.dropRate ?? roundTo(clamp(0.05 + (youthBias < 0 ? 0.05 : 0) - (youthBias > 0 ? 0.015 : 0), 0.01, 0.24), 2)
  const tradeInterest =
    args.row?.tradeInterest ??
    roundTo(
      clamp(
        0.1 + Math.max(0, (ageCurve.currentMultiplier ?? 1) - 1) * 0.4 + youthBias * 0.004,
        0.04,
        0.3
      ),
      2
    )
  const draftFrequency =
    args.row?.draftFrequency ??
    roundTo(
      clamp(
        0.08 +
          (ageCurve.lifecycleStage === 'Prospect' || ageCurve.lifecycleStage === 'Ascendant' ? 0.08 : 0) -
          (ageCurve.lifecycleStage === 'Cliff Risk' ? 0.04 : 0),
        0.02,
        0.28
      ),
      2
    )
  const lineupStartRate =
    args.row?.lineupStartRate ??
    roundTo(
      clamp(
        0.55 +
          (ageCurve.lifecycleStage === 'Prime' ? 0.18 : 0) -
          (ageCurve.lifecycleStage === 'Cliff Risk' ? 0.12 : 0),
        0.18,
        0.92
      ),
      2
    )
  const injuryImpact =
    args.row?.injuryImpact ??
    roundTo(
      clamp(
        ageCurve.riskBand === 'High' ? 0.18 : ageCurve.riskBand === 'Moderate' ? 0.1 : 0.05,
        0.02,
        0.25
      ),
      2
    )

  const scoreDelta =
    args.row?.previousTrendScore != null
      ? roundTo(args.row.trendScore - args.row.previousTrendScore, 1)
      : roundTo(clamp(youthBias * 0.55 - injuryImpact * 12 + (lineupStartRate - 0.5) * 6, -7, 7), 1)
  const trendScore =
    args.row?.trendScore ??
    roundTo(
      clamp(
        50 +
          youthBias * 1.6 +
          ((ageCurve.currentMultiplier ?? 1) - 1) * 38 +
          (tradeInterest - dropRate) * 55 +
          lineupStartRate * 10 -
          injuryImpact * 18,
        24,
        88
      ),
      1
    )

  const canonicalDirection = normalizeMarketDirection(args.row?.trendingDirection, trendScore, scoreDelta)
  const usageChange = roundTo(addRate - dropRate, 2)
  const demandScore = roundTo(
    clamp(
      35 +
        tradeInterest * 28 +
        draftFrequency * 22 +
        lineupStartRate * 20 +
        Math.max(usageChange, 0) * 35 -
        injuryImpact * 30,
      0,
      100
    ),
    1
  )
  const liquidityScore = roundTo(
    clamp(
      42 +
        (ageCurve.lifecycleStage === 'Prospect' ? 14 : 0) +
        (ageCurve.lifecycleStage === 'Ascendant' ? 10 : 0) +
        (ageCurve.lifecycleStage === 'Prime' ? 6 : 0) -
        (ageCurve.lifecycleStage === 'Decline' ? 10 : 0) -
        (ageCurve.lifecycleStage === 'Cliff Risk' ? 18 : 0) +
        (canonicalDirection === 'Hot' ? 10 : canonicalDirection === 'Rising' ? 6 : 0) -
        (canonicalDirection === 'Cold' ? 8 : canonicalDirection === 'Falling' ? 5 : 0) +
        Math.min(14, (ageCurve.yearsToCliff ?? 2) * 2) -
        injuryImpact * 24,
      5,
      100
    ),
    1
  )
  const volatilityScore = roundTo(
    clamp(
      Math.abs(scoreDelta ?? 0) * 4.2 +
        injuryImpact * 64 +
        Math.abs(usageChange) * 30 +
        (ageCurve.lifecycleStage === 'Cliff Risk' ? 18 : 0),
      4,
      95
    ),
    1
  )
  const confidence = roundTo(
    clamp(
      0.44 +
        (args.row ? 0.18 : 0.08) +
        lineupStartRate * 0.15 +
        demandScore / 100 * 0.12 -
        volatilityScore / 100 * 0.08,
      0.35,
      0.94
    ),
    2
  )

  const signals = buildMarketSignals({
    ageCurve,
    tradeInterest,
    lineupStartRate,
    injuryImpact,
    scoreDelta,
    direction: canonicalDirection,
  })

  const factors: MarketTrendFactor[] = [
    { label: 'Add rate', value: addRate, displayValue: `${roundTo(addRate * 100, 0)}%` },
    { label: 'Trade interest', value: tradeInterest, displayValue: `${roundTo(tradeInterest * 100, 0)}%` },
    { label: 'Draft pull', value: draftFrequency, displayValue: `${roundTo(draftFrequency * 100, 0)}%` },
    { label: 'Start rate', value: lineupStartRate, displayValue: `${roundTo(lineupStartRate * 100, 0)}%` },
    { label: 'Injury drag', value: injuryImpact, displayValue: `${roundTo(injuryImpact * 100, 0)}%` },
  ]

  return {
    direction: canonicalDirection,
    canonicalDirection,
    trendScore,
    scoreDelta,
    usageChange,
    demandScore,
    liquidityScore,
    volatilityScore,
    confidence,
    signalLabel: buildSignalLabel(canonicalDirection),
    signals,
    factors,
    updatedAt: args.row?.updatedAt.toISOString() ?? new Date().toISOString(),
  }
}

export function getAgeCurve(
  sport: string,
  position: string,
  currentAge: number | null = null
): AgeCurveResult {
  const normalizedSport = normalizeToSupportedSport(sport)
  const resolvedPosition = normalizePosition(normalizedSport, position)
  const range = getPeakAgeRange(normalizedSport, resolvedPosition)
  const points: AgeCurvePoint[] = []

  for (let age = AGE_RANGE.min; age <= AGE_RANGE.max; age++) {
    const lifecycleStage = classifyDynastyLifecycleStage({
      age,
      peakAgeStart: range.peakStart,
      peakAgeEnd: range.peakEnd,
      cliffAge: range.hardCliff,
    })

    let label: string | null = null
    if (age === range.peakStart) label = 'Peak start'
    else if (age === range.peakEnd) label = 'Peak end'
    else if (age === range.hardCliff) label = 'Cliff'
    else if (currentAge != null && age === currentAge) label = 'Current'

    points.push({
      age,
      multiplier: getSportAwareAgeMultiplier(normalizedSport, resolvedPosition, age),
      label,
      stage: lifecycleStage,
    })
  }

  const currentMultiplier =
    currentAge != null ? getSportAwareAgeMultiplier(normalizedSport, resolvedPosition, currentAge) : null
  const lifecycleStage = classifyDynastyLifecycleStage({
    age: currentAge,
    peakAgeStart: range.peakStart,
    peakAgeEnd: range.peakEnd,
    cliffAge: range.hardCliff,
  })
  const yearsToPeakStart = currentAge != null ? roundTo(Math.max(0, range.peakStart - currentAge), 1) : null
  const yearsToPeakEnd = currentAge != null ? roundTo(Math.max(0, range.peakEnd - currentAge), 1) : null
  const yearsToCliff = currentAge != null ? roundTo(Math.max(0, range.hardCliff - currentAge), 1) : null

  return {
    sport: normalizedSport,
    position: resolvedPosition,
    points,
    peakAgeStart: range.peakStart,
    peakAgeEnd: range.peakEnd,
    cliffAge: range.hardCliff,
    currentAge,
    currentMultiplier,
    lifecycleStage,
    yearsToPeakStart,
    yearsToPeakEnd,
    yearsToCliff,
    riskBand: getRiskBand({ currentAge, currentMultiplier, yearsToCliff }),
  }
}

function buildTrajectoryNote(args: {
  futureAge: number
  peakAgeStart: number
  peakAgeEnd: number
  cliffAge: number
  yearOffset: number
}): string | undefined {
  if (args.yearOffset === 0) return 'Current value anchor'
  if (args.futureAge === args.peakAgeStart) return 'Entering the peak window'
  if (args.futureAge === args.peakAgeEnd) return 'Peak window ending'
  if (args.futureAge >= args.cliffAge) return 'Cliff pressure builds here'
  if (args.futureAge > args.peakAgeEnd) return 'Post-peak erosion begins'
  return undefined
}

export function getCareerTrajectory(
  sport: string,
  position: string,
  age: number,
  baseValue: number,
  marketValueTrend: MarketValueTrend | null = null
): CareerTrajectoryResult {
  const normalizedSport = normalizeToSupportedSport(sport)
  const resolvedPosition = normalizePosition(normalizedSport, position)
  const range = getPeakAgeRange(normalizedSport, resolvedPosition)
  const currentAgeMultiplier = getSportAwareAgeMultiplier(normalizedSport, resolvedPosition, age)
  const currentWindow = getSportAwareExpectedWindow(normalizedSport, resolvedPosition, age)
  const momentum =
    marketValueTrend != null
      ? clamp(
          (marketValueTrend.trendScore - 50) / 260 +
            (marketValueTrend.scoreDelta ?? 0) / 90 -
            marketValueTrend.volatilityScore / 750,
          -0.14,
          0.14
        )
      : 0
  const yearOffsets = [0, 1, 2, 3, 5]
  const points: CareerTrajectoryPoint[] = yearOffsets.map((yearOffset) => {
    const futureAge = age + yearOffset
    const ageMultiplier = getSportAwareAgeMultiplier(normalizedSport, resolvedPosition, futureAge)
    const windowYears = getSportAwareExpectedWindow(normalizedSport, resolvedPosition, futureAge)
    const relativeAgeMultiplier = ageMultiplier / Math.max(0.55, currentAgeMultiplier)
    const windowRetention = windowYears / Math.max(0.5, currentWindow)
    const momentumRetention = 1 + momentum * Math.max(0.3, 1 - yearOffset * 0.17)
    const projectedValue = roundTo(
      Math.max(
        0,
        baseValue * relativeAgeMultiplier * (0.68 + 0.32 * windowRetention) * momentumRetention
      ),
      0
    )

    return {
      yearOffset,
      age: futureAge,
      projectedValue,
      ageMultiplier,
      windowYears,
      retentionRate: roundTo(projectedValue / Math.max(1, baseValue), 3),
      note: buildTrajectoryNote({
        futureAge,
        peakAgeStart: range.peakStart,
        peakAgeEnd: range.peakEnd,
        cliffAge: range.hardCliff,
        yearOffset,
      }),
    }
  })

  const peakPoint = [...points].sort((a, b) => b.projectedValue - a.projectedValue)[0] ?? points[0]
  const year3Point = points.find((point) => point.yearOffset === 3) ?? null
  const year5Point = points.find((point) => point.yearOffset === 5) ?? null
  const valueChangePctYear3 =
    year3Point != null
      ? roundTo(((year3Point.projectedValue - baseValue) / Math.max(1, baseValue)) * 100, 1)
      : null
  const valueChangePctYear5 =
    year5Point != null
      ? roundTo(((year5Point.projectedValue - baseValue) / Math.max(1, baseValue)) * 100, 1)
      : null
  const cliffYearOffset =
    points.find(
      (point) =>
        point.yearOffset > 0 && (point.age >= range.hardCliff || point.projectedValue <= baseValue * 0.72)
    )?.yearOffset ?? null

  let trajectoryLabel: DynastyTrajectoryLabel = 'Stable'
  if (cliffYearOffset != null && cliffYearOffset <= 3) trajectoryLabel = 'Cliff Risk'
  else if ((valueChangePctYear3 ?? 0) >= 8) trajectoryLabel = 'Ascending'
  else if ((valueChangePctYear3 ?? 0) <= -10) trajectoryLabel = 'Declining'

  return {
    sport: normalizedSport,
    position: resolvedPosition,
    age,
    baseValue,
    points,
    expectedWindowYears: currentWindow,
    peakProjectedValue: peakPoint?.projectedValue ?? baseValue,
    peakYearOffset: peakPoint?.yearOffset ?? 0,
    valueChangePctYear3,
    valueChangePctYear5,
    trajectoryLabel,
    cliffYearOffset,
    retentionScore: roundTo(((year3Point?.projectedValue ?? baseValue) / Math.max(1, baseValue)) * 100, 0),
  }
}

export function buildDynastyValuationBreakdown(args: {
  sport: string
  position: string
  age: number | null
  currentValue: number
  ageCurve: AgeCurveResult
  marketValueTrend: MarketValueTrend | null
  careerTrajectory: CareerTrajectoryResult | null
  isSuperFlex: boolean
  isTightEndPremium: boolean
}): DynastyValuationBreakdown | null {
  if (args.age == null) return null

  const positionMultiplier = getSportAwarePositionMultiplier(
    args.sport,
    args.position,
    args.isSuperFlex,
    args.isTightEndPremium
  )
  const ageMultiplier = getSportAwareAgeMultiplier(args.sport, args.position, args.age)
  const windowYears = getSportAwareExpectedWindow(args.sport, args.position, args.age)
  const windowMultiplier = roundTo(clamp(getWindowMultiplier(windowYears) / 2, 0.65, 1.65), 2)

  let liquidityMultiplier = 1
  if (args.ageCurve.lifecycleStage === 'Prospect') liquidityMultiplier += 0.1
  else if (args.ageCurve.lifecycleStage === 'Ascendant') liquidityMultiplier += 0.07
  else if (args.ageCurve.lifecycleStage === 'Decline') liquidityMultiplier -= 0.08
  else if (args.ageCurve.lifecycleStage === 'Cliff Risk') liquidityMultiplier -= 0.16
  if (args.marketValueTrend?.canonicalDirection === 'Hot') liquidityMultiplier += 0.06
  else if (args.marketValueTrend?.canonicalDirection === 'Rising') liquidityMultiplier += 0.03
  else if (args.marketValueTrend?.canonicalDirection === 'Falling') liquidityMultiplier -= 0.04
  else if (args.marketValueTrend?.canonicalDirection === 'Cold') liquidityMultiplier -= 0.08
  liquidityMultiplier = roundTo(clamp(liquidityMultiplier, 0.78, 1.2), 2)

  const marketPulse = roundTo(
    clamp(
      args.marketValueTrend != null
        ? (args.marketValueTrend.trendScore - 50) / 260 +
            (args.marketValueTrend.scoreDelta ?? 0) / 90 +
            args.marketValueTrend.demandScore / 500 -
            args.marketValueTrend.volatilityScore / 650
        : 0,
      -0.22,
      0.24
    ),
    3
  )
  const careerArc = roundTo(
    args.careerTrajectory != null
      ? ((args.careerTrajectory.valueChangePctYear3 ?? 0) +
          (args.careerTrajectory.valueChangePctYear5 ?? 0)) /
          2
      : 0,
    1
  )
  const dynastyScore = roundTo(
    args.currentValue *
      positionMultiplier *
      ageMultiplier *
      windowMultiplier *
      liquidityMultiplier *
      (1 + marketPulse),
    0
  )
  const riskScore = roundTo(
    clamp(
      18 +
        (args.ageCurve.riskBand === 'High' ? 30 : args.ageCurve.riskBand === 'Moderate' ? 16 : 6) +
        (args.marketValueTrend?.volatilityScore ?? 25) * 0.35 -
        (args.marketValueTrend?.canonicalDirection === 'Hot' ? 8 : 0) -
        (args.careerTrajectory?.trajectoryLabel === 'Ascending' ? 8 : 0),
      5,
      95
    ),
    0
  )

  return {
    dynastyScore,
    positionMultiplier,
    ageMultiplier,
    windowMultiplier,
    liquidityMultiplier,
    marketPulse,
    careerArc,
    riskScore,
  }
}

function buildValuationBand(score: number): DynastyValuationBand {
  if (score >= 8200) return 'Untouchable'
  if (score >= 6200) return 'Core Asset'
  if (score >= 4300) return 'Starter'
  if (score >= 2700) return 'Fragile'
  return 'Depth'
}

function buildRecommendation(args: {
  lifecycleStage: DynastyLifecycleStage
  marketDirection: DynastyMarketDirection | null
  trajectoryLabel: DynastyTrajectoryLabel | null
}): DynastyRecommendation {
  if (
    args.lifecycleStage === 'Cliff Risk' ||
    args.trajectoryLabel === 'Cliff Risk' ||
    ((args.marketDirection === 'Falling' || args.marketDirection === 'Cold') &&
      args.lifecycleStage === 'Decline')
  ) {
    return 'Sell'
  }
  if (
    (args.lifecycleStage === 'Prospect' || args.lifecycleStage === 'Ascendant') &&
    args.trajectoryLabel === 'Ascending' &&
    args.marketDirection !== 'Cold'
  ) {
    return 'Buy'
  }
  if (
    args.lifecycleStage === 'Prime' &&
    args.marketDirection !== 'Cold' &&
    args.trajectoryLabel !== 'Declining'
  ) {
    return 'Hold'
  }
  return 'Monitor'
}

function buildOverviewCards(payload: {
  ageCurve: AgeCurveResult
  marketValueTrend: MarketValueTrend | null
  careerTrajectory: CareerTrajectoryResult | null
  valuationBreakdown: DynastyValuationBreakdown | null
  valuationBand: DynastyValuationBand
  marketRecommendation: DynastyRecommendation
}): DynastyOverviewCard[] {
  return [
    {
      id: 'lifecycle',
      label: 'Lifecycle',
      value: payload.ageCurve.lifecycleStage,
      detail: `Peak ${payload.ageCurve.peakAgeStart}-${payload.ageCurve.peakAgeEnd} | cliff at ${payload.ageCurve.cliffAge}`,
      tone:
        payload.ageCurve.lifecycleStage === 'Prospect' || payload.ageCurve.lifecycleStage === 'Ascendant'
          ? 'positive'
          : payload.ageCurve.lifecycleStage === 'Cliff Risk'
            ? 'negative'
            : 'neutral',
    },
    {
      id: 'valuation',
      label: 'Dynasty score',
      value: `${payload.valuationBreakdown?.dynastyScore ?? '--'}`,
      detail: `${payload.valuationBand} | risk ${payload.valuationBreakdown?.riskScore ?? '--'}`,
      tone:
        payload.valuationBand === 'Untouchable' || payload.valuationBand === 'Core Asset'
          ? 'positive'
          : payload.valuationBand === 'Fragile' || payload.valuationBand === 'Depth'
            ? 'negative'
            : 'neutral',
    },
    {
      id: 'market',
      label: 'Market trend',
      value: payload.marketValueTrend?.direction ?? 'Stable',
      detail: payload.marketValueTrend
        ? `${payload.marketValueTrend.trendScore.toFixed(1)} trend score | ${payload.marketValueTrend.signalLabel}`
        : 'No market pulse available',
      tone:
        payload.marketValueTrend?.canonicalDirection === 'Hot' ||
        payload.marketValueTrend?.canonicalDirection === 'Rising'
          ? 'positive'
          : payload.marketValueTrend?.canonicalDirection === 'Cold' ||
              payload.marketValueTrend?.canonicalDirection === 'Falling'
            ? 'negative'
            : 'neutral',
    },
    {
      id: 'action',
      label: 'Recommendation',
      value: payload.marketRecommendation,
      detail: payload.careerTrajectory
        ? `${payload.careerTrajectory.trajectoryLabel} arc | ${payload.careerTrajectory.expectedWindowYears} year window`
        : 'Need age and value inputs for a fuller arc read',
      tone:
        payload.marketRecommendation === 'Buy'
          ? 'positive'
          : payload.marketRecommendation === 'Sell'
            ? 'negative'
            : 'neutral',
    },
  ]
}

export async function getMarketValueTrend(
  playerId: string,
  sport: string,
  context?: { position?: string; age?: number | null; currentValue?: number }
): Promise<MarketValueTrend | null> {
  const normalizedSport = normalizeToSupportedSport(sport)
  const resolvedPosition = normalizePosition(normalizedSport, context?.position)
  const row = await prisma.playerMetaTrend.findUnique({
    where: { uniq_player_meta_trend_player_sport: { playerId, sport: normalizedSport } },
    select: {
      trendScore: true,
      previousTrendScore: true,
      addRate: true,
      dropRate: true,
      tradeInterest: true,
      draftFrequency: true,
      lineupStartRate: true,
      injuryImpact: true,
      trendingDirection: true,
      updatedAt: true,
    },
  })

  if (!row && !context) return null

  return buildDeterministicMarketValueTrend({
    sport: normalizedSport,
    position: resolvedPosition,
    age: context?.age ?? null,
    currentValue: context?.currentValue ?? 0,
    row,
  })
}

export async function getPlayerDynastyIntelligence(
  options: DynastyIntelligenceOptions
): Promise<PlayerDynastyIntelligence> {
  const normalizedSport = normalizeToSupportedSport(options.sport)
  const playerId = options.playerId?.trim() || undefined

  const [player, trendRow] = playerId
    ? await Promise.all([
        prisma.player.findFirst({
          where: { id: playerId, sport: normalizedSport },
          select: {
            id: true,
            name: true,
            sport: true,
            position: true,
            team: true,
            birthYear: true,
          },
        }),
        prisma.playerMetaTrend.findUnique({
          where: { uniq_player_meta_trend_player_sport: { playerId, sport: normalizedSport } },
          select: {
            trendScore: true,
            previousTrendScore: true,
            addRate: true,
            dropRate: true,
            tradeInterest: true,
            draftFrequency: true,
            lineupStartRate: true,
            injuryImpact: true,
            trendingDirection: true,
            updatedAt: true,
          },
        }),
      ])
    : [null, null]

  const resolvedPosition = normalizePosition(
    normalizedSport,
    player?.position ?? options.position ?? DEFAULT_POSITION_BY_SPORT[normalizedSport]
  )
  const resolvedAge =
    typeof options.age === 'number' && Number.isFinite(options.age)
      ? options.age
      : player?.birthYear != null
        ? new Date().getFullYear() - player.birthYear
        : null
  const currentValue = inferBaseValue({
    sport: normalizedSport,
    position: resolvedPosition,
    age: resolvedAge,
    explicitBaseValue: options.baseValue,
    displayName: player?.name ?? null,
    trendRow,
  })
  const ageCurve = getAgeCurve(normalizedSport, resolvedPosition, resolvedAge)
  const marketValueTrend = buildDeterministicMarketValueTrend({
    sport: normalizedSport,
    position: resolvedPosition,
    age: resolvedAge,
    currentValue,
    row: trendRow,
    ageCurve,
  })
  const careerTrajectory =
    resolvedAge != null
      ? getCareerTrajectory(normalizedSport, resolvedPosition, resolvedAge, currentValue, marketValueTrend)
      : null
  const valuationBreakdown = buildDynastyValuationBreakdown({
    sport: normalizedSport,
    position: resolvedPosition,
    age: resolvedAge,
    currentValue,
    ageCurve,
    marketValueTrend,
    careerTrajectory,
    isSuperFlex: Boolean(options.isSuperFlex),
    isTightEndPremium: Boolean(options.isTightEndPremium),
  })
  const valuationBand = buildValuationBand(valuationBreakdown?.dynastyScore ?? currentValue)
  const marketRecommendation = buildRecommendation({
    lifecycleStage: ageCurve.lifecycleStage,
    marketDirection: marketValueTrend?.canonicalDirection ?? null,
    trajectoryLabel: careerTrajectory?.trajectoryLabel ?? null,
  })

  return {
    playerId,
    displayName: player?.name ?? null,
    sport: normalizedSport,
    position: resolvedPosition,
    team: player?.team ?? null,
    age: resolvedAge,
    currentValue,
    ageCurve,
    marketValueTrend,
    careerTrajectory,
    lifecycleStage: ageCurve.lifecycleStage,
    valuationBand,
    marketRecommendation,
    valuationBreakdown,
    overviewCards: buildOverviewCards({
      ageCurve,
      marketValueTrend,
      careerTrajectory,
      valuationBreakdown,
      valuationBand,
      marketRecommendation,
    }),
    generatedAt: new Date().toISOString(),
  }
}

export function getDynastyIntelligenceSupportedSports(): readonly string[] {
  return SUPPORTED_SPORTS
}

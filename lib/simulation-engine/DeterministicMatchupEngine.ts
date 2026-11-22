import {
  getPositionSlotWeight,
  getPositionSlotsForSport,
} from '@/lib/matchup-simulator/PositionComparisonResolver'
import { getDefaultScoreStdDev, getVolatilityTag } from './SportSimulationResolver'
import { percentiles } from './ScoreDistributionModel'
import type {
  MatchupLineupSlotInput,
  MatchupScheduleFactorsInput,
  MatchupSimulationInput,
  MatchupSimulationOutput,
  MatchupSimulationTeamInput,
  MatchupSimulationTeamSummary,
  MatchupSlotComparisonRow,
} from './types'
import { normalizeSportForSimulation, type SimulationSport } from './types'

const DEFAULT_ITERATIONS = 2000
const MIN_ITERATIONS = 1000
const MAX_ITERATIONS = 5000

const SPORT_SCHEDULE_WEIGHTS: Record<
  SimulationSport,
  {
    venue: number
    rest: number
    matchup: number
    tempo: number
    venueVariance: number
    restVariance: number
    matchupVariance: number
    tempoVariance: number
  }
> = {
  NFL: {
    venue: 0.018,
    rest: 0.028,
    matchup: 0.04,
    tempo: 0.022,
    venueVariance: 0.03,
    restVariance: 0.05,
    matchupVariance: 0.04,
    tempoVariance: 0.05,
  },
  NHL: {
    venue: 0.014,
    rest: 0.024,
    matchup: 0.03,
    tempo: 0.028,
    venueVariance: 0.025,
    restVariance: 0.04,
    matchupVariance: 0.035,
    tempoVariance: 0.045,
  },
  NBA: {
    venue: 0.014,
    rest: 0.03,
    matchup: 0.026,
    tempo: 0.038,
    venueVariance: 0.022,
    restVariance: 0.05,
    matchupVariance: 0.03,
    tempoVariance: 0.055,
  },
  MLB: {
    venue: 0.01,
    rest: 0.018,
    matchup: 0.036,
    tempo: 0.028,
    venueVariance: 0.02,
    restVariance: 0.03,
    matchupVariance: 0.04,
    tempoVariance: 0.05,
  },
  NCAAB: {
    venue: 0.017,
    rest: 0.027,
    matchup: 0.03,
    tempo: 0.034,
    venueVariance: 0.025,
    restVariance: 0.048,
    matchupVariance: 0.035,
    tempoVariance: 0.052,
  },
  NCAAF: {
    venue: 0.019,
    rest: 0.03,
    matchup: 0.038,
    tempo: 0.024,
    venueVariance: 0.03,
    restVariance: 0.05,
    matchupVariance: 0.04,
    tempoVariance: 0.05,
  },
  SOCCER: {
    venue: 0.02,
    rest: 0.028,
    matchup: 0.032,
    tempo: 0.018,
    venueVariance: 0.028,
    restVariance: 0.045,
    matchupVariance: 0.036,
    tempoVariance: 0.04,
  },
}

type LineupSlotModel = MatchupSimulationTeamSummary['lineup'][number]

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function roundToTenth(value: number): number {
  return Math.round(value * 10) / 10
}

function normalizeScheduleFactors(
  factors?: MatchupScheduleFactorsInput
): Required<MatchupScheduleFactorsInput> {
  return {
    venue: clamp(Number(factors?.venue ?? 0), -1, 1),
    rest: clamp(Number(factors?.rest ?? 0), -1, 1),
    matchup: clamp(Number(factors?.matchup ?? 0), -1, 1),
    tempo: clamp(Number(factors?.tempo ?? 0), -1, 1),
  }
}

function hashString(input: string): number {
  let hash = 2166136261
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

function createSeededRandom(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state += 0x6d2b79f5
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function randomNormal(rng: () => number, mean: number, stdDev: number): number {
  const u1 = Math.max(rng(), 1e-9)
  const u2 = Math.max(rng(), 1e-9)
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2)
  return mean + z * stdDev
}

function getLineupOrderIndex(sport: string, slotId: string, fallbackIndex: number): number {
  const slots = getPositionSlotsForSport(sport)
  const index = slots.findIndex((slot) => slot.id === slotId)
  return index >= 0 ? index : fallbackIndex
}

function normalizeLineupSlot(
  slot: MatchupLineupSlotInput,
  fallbackLabel: string,
  defaultStdDev: number
): MatchupLineupSlotInput {
  const projection = Number(slot.projection ?? 0)
  const spread =
    Math.max(1.5, defaultStdDev * 0.4) *
    clamp(Number(slot.volatility ?? 1), 0.65, 1.5)
  const floor = Number.isFinite(slot.floor) ? Number(slot.floor) : projection - spread
  const ceiling = Number.isFinite(slot.ceiling) ? Number(slot.ceiling) : projection + spread

  return {
    slotId: slot.slotId,
    slotLabel: slot.slotLabel ?? fallbackLabel,
    playerName: slot.playerName ?? fallbackLabel,
    projection: roundToTenth(projection),
    floor: roundToTenth(Math.max(0, Math.min(floor, projection))),
    ceiling: roundToTenth(Math.max(projection, ceiling)),
    volatility: clamp(Number(slot.volatility ?? 1), 0.65, 1.5),
  }
}

function buildSyntheticLineup(
  teamInput: MatchupSimulationTeamInput,
  sport: string
): MatchupLineupSlotInput[] {
  const baseMean = Number(teamInput.mean ?? 100)
  const baseStdDev = Math.max(1, Number(teamInput.stdDev ?? getDefaultScoreStdDev(sport)))
  const slots = getPositionSlotsForSport(sport)
  const totalWeight =
    slots.reduce((sum, slot) => sum + getPositionSlotWeight(slot.id), 0) || 1

  const rawLineup = slots.map((slot, index) => {
    const allocation = getPositionSlotWeight(slot.id) / totalWeight
    const projection = baseMean * allocation + (slots.length - index) * 0.03
    const spread = Math.max(1.5, baseStdDev * (0.45 + allocation))
    return {
      slotId: slot.id,
      slotLabel: slot.label,
      playerName: slot.label,
      projection,
      floor: Math.max(0, projection - spread),
      ceiling: projection + spread,
      volatility: clamp(0.9 + (getPositionSlotWeight(slot.id) - 1) * 0.3, 0.7, 1.3),
    }
  })

  const totalProjection =
    rawLineup.reduce((sum, slot) => sum + slot.projection, 0) || baseMean || 1
  const scale = baseMean / totalProjection

  return rawLineup.map((slot) => ({
    ...slot,
    projection: roundToTenth(slot.projection * scale),
    floor: roundToTenth((slot.floor ?? slot.projection) * scale),
    ceiling: roundToTenth((slot.ceiling ?? slot.projection) * scale),
  }))
}

function getResolvedLineup(
  teamInput: MatchupSimulationTeamInput,
  sport: string
): MatchupLineupSlotInput[] {
  const defaultStdDev = Math.max(1, Number(teamInput.stdDev ?? getDefaultScoreStdDev(sport)))
  const rawLineup =
    Array.isArray(teamInput.lineup) && teamInput.lineup.length > 0
      ? teamInput.lineup
      : buildSyntheticLineup(teamInput, sport)

  return rawLineup
    .map((slot, index) => {
      const fallbackLabel =
        slot.slotLabel ??
        getPositionSlotsForSport(sport)[getLineupOrderIndex(sport, slot.slotId, index)]?.label ??
        slot.slotId
      return normalizeLineupSlot(slot, fallbackLabel, defaultStdDev)
    })
    .sort(
      (slotA, slotB) =>
        getLineupOrderIndex(sport, slotA.slotId, 999) -
        getLineupOrderIndex(sport, slotB.slotId, 999)
    )
}

export function summarizeMatchupTeamInput(
  teamInput: MatchupSimulationTeamInput,
  sport: string
): MatchupSimulationTeamSummary {
  const normalizedSport = normalizeSportForSimulation(sport)
  const lineup = getResolvedLineup(teamInput, normalizedSport)
  const scheduleFactors = normalizeScheduleFactors(teamInput.scheduleFactors)
  const weights = SPORT_SCHEDULE_WEIGHTS[normalizedSport]
  const meanMultiplier =
    1 +
    scheduleFactors.venue * weights.venue +
    scheduleFactors.rest * weights.rest +
    scheduleFactors.matchup * weights.matchup +
    scheduleFactors.tempo * weights.tempo
  const varianceMultiplier =
    1 +
    Math.abs(scheduleFactors.venue) * weights.venueVariance +
    Math.abs(scheduleFactors.rest) * weights.restVariance +
    Math.abs(scheduleFactors.matchup) * weights.matchupVariance +
    Math.abs(scheduleFactors.tempo) * weights.tempoVariance

  const lineupSummaries = lineup.map((slot) => {
    const projection = Number(slot.projection ?? 0)
    const floor = Number(slot.floor ?? projection)
    const ceiling = Number(slot.ceiling ?? projection)
    const baseStdDev = Math.max(0.8, (ceiling - floor) / 2.6)
    const weight = getPositionSlotWeight(slot.slotId)
    const slotImpactWeight = 0.82 + (weight - 1) * 0.65
    const scheduleImpact = projection * (meanMultiplier - 1) * slotImpactWeight
    const adjustedProjection = projection + scheduleImpact
    const sampleStdDev =
      baseStdDev *
      varianceMultiplier *
      clamp(Number(slot.volatility ?? 1), 0.65, 1.5)
    const adjustedFloor = Math.max(
      0,
      Math.min(floor + scheduleImpact * 0.45, adjustedProjection - sampleStdDev * 1.25)
    )
    const adjustedCeiling = Math.max(
      adjustedProjection + 0.5,
      Math.max(ceiling + scheduleImpact * 0.8, adjustedProjection + sampleStdDev * 1.25)
    )

    return {
      slotId: slot.slotId,
      slotLabel: slot.slotLabel ?? slot.slotId,
      playerName: slot.playerName ?? slot.slotLabel ?? slot.slotId,
      projection: roundToTenth(projection),
      adjustedProjection: roundToTenth(adjustedProjection),
      floor: roundToTenth(adjustedFloor),
      ceiling: roundToTenth(adjustedCeiling),
      sampleStdDev: roundToTenth(sampleStdDev),
      volatility: clamp(Number(slot.volatility ?? 1), 0.65, 1.5),
      scheduleImpact: roundToTenth(scheduleImpact),
    }
  })

  const baselineMean =
    lineupSummaries.reduce((sum, slot) => sum + slot.projection, 0) ||
    Number(teamInput.mean ?? 0)
  const adjustedMean = lineupSummaries.reduce(
    (sum, slot) => sum + slot.adjustedProjection,
    0
  )
  const adjustedFloor = lineupSummaries.reduce((sum, slot) => sum + slot.floor, 0)
  const adjustedCeiling = lineupSummaries.reduce((sum, slot) => sum + slot.ceiling, 0)
  const derivedStdDev = Math.max(
    1,
    Math.sqrt(
      lineupSummaries.reduce(
        (sum, slot) => sum + slot.sampleStdDev * slot.sampleStdDev,
        0
      )
    )
  )

  return {
    baselineMean: roundToTenth(baselineMean),
    adjustedMean: roundToTenth(adjustedMean),
    adjustedFloor: roundToTenth(adjustedFloor),
    adjustedCeiling: roundToTenth(adjustedCeiling),
    derivedStdDev: roundToTenth(derivedStdDev),
    scheduleAdjustment: roundToTenth(adjustedMean - baselineMean),
    scheduleMultiplier: Math.round(meanMultiplier * 1000) / 1000,
    scheduleFactors,
    lineup: lineupSummaries,
  }
}

export function buildMatchupSlotComparisons(
  teamSummaryA: MatchupSimulationTeamSummary,
  teamSummaryB: MatchupSimulationTeamSummary
): MatchupSlotComparisonRow[] {
  const maxSlots = Math.max(teamSummaryA.lineup.length, teamSummaryB.lineup.length)

  return Array.from({ length: maxSlots }, (_, index) => {
    const slotA = teamSummaryA.lineup[index]
    const slotB = teamSummaryB.lineup[index]
    const slotLabel = slotA?.slotLabel ?? slotB?.slotLabel ?? `Slot ${index + 1}`
    const teamAScore = roundToTenth(slotA?.adjustedProjection ?? 0)
    const teamBScore = roundToTenth(slotB?.adjustedProjection ?? 0)
    const edge = roundToTenth(teamAScore - teamBScore)
    const absEdge = Math.abs(edge)
    const advantage: MatchupSlotComparisonRow['advantage'] =
      absEdge < 0.2 ? 'even' : edge > 0 ? 'A' : 'B'

    return {
      slotId: slotA?.slotId ?? slotB?.slotId ?? `slot-${index + 1}`,
      slotLabel,
      teamAPlayerName: slotA?.playerName ?? slotLabel,
      teamBPlayerName: slotB?.playerName ?? slotLabel,
      teamAScore,
      teamBScore,
      edge,
      advantage,
      edgeLabel:
        advantage === 'even'
          ? 'Even'
          : `${advantage === 'A' ? 'Team A' : 'Team B'} +${absEdge.toFixed(1)}`,
    }
  })
}

function createSeedPayload(
  sport: string,
  weekOrPeriod: number,
  iterations: number,
  teamSummaryA: MatchupSimulationTeamSummary,
  teamSummaryB: MatchupSimulationTeamSummary,
  deterministicSeed?: string
) {
  return JSON.stringify({
    sport,
    weekOrPeriod,
    iterations,
    deterministicSeed: deterministicSeed ?? null,
    teamA: {
      scheduleFactors: teamSummaryA.scheduleFactors,
      lineup: teamSummaryA.lineup.map((slot) => [
        slot.slotId,
        slot.projection,
        slot.floor,
        slot.ceiling,
        slot.volatility,
      ]),
    },
    teamB: {
      scheduleFactors: teamSummaryB.scheduleFactors,
      lineup: teamSummaryB.lineup.map((slot) => [
        slot.slotId,
        slot.projection,
        slot.floor,
        slot.ceiling,
        slot.volatility,
      ]),
    },
  })
}

function sampleSlotScore(
  slot: LineupSlotModel,
  rng: () => number,
  sharedShock: number
): number {
  const rawScore = randomNormal(rng, slot.adjustedProjection + sharedShock, slot.sampleStdDev)
  return clamp(rawScore, slot.floor, slot.ceiling)
}

function trimDistribution(samples: number[]): number[] {
  if (samples.length <= 120) {
    return samples.map((value) => roundToTenth(value))
  }

  const step = Math.max(1, Math.floor(samples.length / 120))
  const trimmed: number[] = []
  for (let index = 0; index < samples.length && trimmed.length < 120; index += step) {
    trimmed.push(roundToTenth(samples[index] ?? 0))
  }
  return trimmed
}

export function simulateDeterministicMatchup(
  input: MatchupSimulationInput
): MatchupSimulationOutput {
  const sport = normalizeSportForSimulation(input.sport)
  const iterations = clamp(
    Number(input.iterations ?? DEFAULT_ITERATIONS),
    MIN_ITERATIONS,
    MAX_ITERATIONS
  )
  const teamSummaryA = summarizeMatchupTeamInput(input.teamA, sport)
  const teamSummaryB = summarizeMatchupTeamInput(input.teamB, sport)
  const deterministicSeed = hashString(
    createSeedPayload(
      sport,
      Number(input.weekOrPeriod) || 1,
      iterations,
      teamSummaryA,
      teamSummaryB,
      input.deterministicSeed
    )
  )
  const rng = createSeededRandom(deterministicSeed)

  let winsA = 0
  let marginSum = 0
  let marginSquaredSum = 0
  let scoreSumA = 0
  let scoreSumB = 0
  const scoresA: number[] = []
  const scoresB: number[] = []

  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const sharedShockA = randomNormal(
      rng,
      0,
      Math.max(0.35, teamSummaryA.derivedStdDev * 0.055)
    )
    const sharedShockB = randomNormal(
      rng,
      0,
      Math.max(0.35, teamSummaryB.derivedStdDev * 0.055)
    )

    const scoreA = teamSummaryA.lineup.reduce(
      (sum, slot) =>
        sum + sampleSlotScore(slot, rng, sharedShockA / Math.max(2, teamSummaryA.lineup.length)),
      0
    )
    const scoreB = teamSummaryB.lineup.reduce(
      (sum, slot) =>
        sum + sampleSlotScore(slot, rng, sharedShockB / Math.max(2, teamSummaryB.lineup.length)),
      0
    )
    const boundedScoreA = Math.max(0, scoreA)
    const boundedScoreB = Math.max(0, scoreB)
    const margin = boundedScoreA - boundedScoreB

    if (boundedScoreA > boundedScoreB) winsA += 1
    marginSum += margin
    marginSquaredSum += margin * margin
    scoreSumA += boundedScoreA
    scoreSumB += boundedScoreB
    scoresA.push(roundToTenth(boundedScoreA))
    scoresB.push(roundToTenth(boundedScoreB))
  }

  const winProbabilityA = Math.round((winsA / iterations) * 1000) / 1000
  const winProbabilityB = Math.round((1 - winProbabilityA) * 1000) / 1000
  const marginMean = marginSum / iterations
  const marginVariance = marginSquaredSum / iterations - marginMean * marginMean
  const expectedScoreA = scoreSumA / iterations
  const expectedScoreB = scoreSumB / iterations
  const combinedStdDev = (teamSummaryA.derivedStdDev + teamSummaryB.derivedStdDev) / 2
  const sortedA = [...scoresA].sort((scoreA, scoreB) => scoreA - scoreB)
  const sortedB = [...scoresB].sort((scoreA, scoreB) => scoreA - scoreB)
  const [a10, a90] = percentiles(sortedA, [10, 90])
  const [b10, b90] = percentiles(sortedB, [10, 90])
  const slotComparisons = buildMatchupSlotComparisons(teamSummaryA, teamSummaryB)

  return {
    sport,
    leagueId: input.leagueId,
    weekOrPeriod: Number(input.weekOrPeriod) || 1,
    expectedScoreA: roundToTenth(expectedScoreA),
    expectedScoreB: roundToTenth(expectedScoreB),
    winProbabilityA,
    winProbabilityB,
    scoreDistributionA: trimDistribution(sortedA),
    scoreDistributionB: trimDistribution(sortedB),
    marginMean: roundToTenth(marginMean),
    marginStdDev: roundToTenth(Math.sqrt(Math.max(0, marginVariance))),
    upsetChance: Math.round(Math.min(winProbabilityA, winProbabilityB) * 1000) / 10,
    volatilityTag: getVolatilityTag(combinedStdDev),
    iterations,
    deterministicSeed,
    scoreRangeA: [roundToTenth(a10), roundToTenth(a90)],
    scoreRangeB: [roundToTenth(b10), roundToTenth(b90)],
    upsideScenario: {
      teamA: roundToTenth(a90),
      teamB: roundToTenth(b90),
      percentile: 90,
    },
    downsideScenario: {
      teamA: roundToTenth(a10),
      teamB: roundToTenth(b10),
      percentile: 10,
    },
    teamSummaryA,
    teamSummaryB,
    slotComparisons,
  }
}

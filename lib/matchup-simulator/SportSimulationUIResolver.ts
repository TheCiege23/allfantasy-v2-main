/**
 * SportSimulationUIResolver — sport-aware UI labels for simulation (volatility, sport name).
 * Aligns with lib/sport-scope and simulation-engine SportSimulationResolver.
 */

import { SUPPORTED_SPORTS, normalizeToSupportedSport } from '@/lib/sport-scope'
import type {
  MatchupLineupSlotInput,
  MatchupScheduleFactorsInput,
} from '@/lib/simulation-engine/types'
import { getPositionSlotsForSport, getPositionSlotWeight } from './PositionComparisonResolver'

type SportOption = { value: string; label: string }
export type SimulationTeamPreset = {
  id: string
  name: string
  mean: number
  stdDev: number
  scheduleFactors?: MatchupScheduleFactorsInput
}
type SimulationScheduleFactorDefinition = {
  id: keyof MatchupScheduleFactorsInput
  label: string
  description: string
  options: Array<{ value: number; label: string }>
}

const SPORT_LABELS: Record<string, string> = {
  NFL: 'NFL',
  NHL: 'NHL',
  NBA: 'NBA',
  MLB: 'MLB',
  NCAAB: 'NCAA Basketball',
  NCAAF: 'NCAA Football',
  SOCCER: 'Soccer',
}

const SPORT_TEAM_PRESETS: Record<string, SimulationTeamPreset[]> = {
  NFL: [
    { id: 'nfl-sharks', name: 'Gridiron Sharks', mean: 119, stdDev: 14, scheduleFactors: { venue: 0.5, rest: 0.5, matchup: 0.5, tempo: 0.25 } },
    { id: 'nfl-wolves', name: 'Sunday Wolves', mean: 112, stdDev: 15, scheduleFactors: { venue: -0.5, rest: 0, matchup: -0.5, tempo: -0.25 } },
    { id: 'nfl-hawks', name: 'Red Zone Hawks', mean: 116, stdDev: 13, scheduleFactors: { venue: 0, rest: 0.5, matchup: 0, tempo: 0.5 } },
  ],
  NHL: [
    { id: 'nhl-blades', name: 'Ice Blades', mean: 42, stdDev: 7, scheduleFactors: { venue: 0.5, rest: 0, matchup: 0.5, tempo: 0 } },
    { id: 'nhl-pucks', name: 'Power Play Pucks', mean: 40, stdDev: 8, scheduleFactors: { venue: -0.5, rest: -0.5, matchup: 0, tempo: 0.5 } },
    { id: 'nhl-frost', name: 'Frostbite Line', mean: 44, stdDev: 7, scheduleFactors: { venue: 0, rest: 0.5, matchup: 0.25, tempo: -0.25 } },
  ],
  NBA: [
    { id: 'nba-rim', name: 'Rim Runners', mean: 131, stdDev: 16, scheduleFactors: { venue: 0.5, rest: 0, matchup: 0.25, tempo: 1 } },
    { id: 'nba-glass', name: 'Glass Cleaners', mean: 126, stdDev: 15, scheduleFactors: { venue: -0.5, rest: -0.5, matchup: 0.5, tempo: -0.25 } },
    { id: 'nba-break', name: 'Fast Break Union', mean: 129, stdDev: 14, scheduleFactors: { venue: 0, rest: 0.5, matchup: 0, tempo: 0.75 } },
  ],
  MLB: [
    { id: 'mlb-bats', name: 'Launch Angle Bats', mean: 57, stdDev: 10, scheduleFactors: { venue: 0.5, rest: 0, matchup: 0.75, tempo: 0.5 } },
    { id: 'mlb-aces', name: 'Bullpen Aces', mean: 54, stdDev: 9, scheduleFactors: { venue: 0, rest: 0.5, matchup: -0.5, tempo: -0.5 } },
    { id: 'mlb-rbi', name: 'RBI Syndicate', mean: 56, stdDev: 9, scheduleFactors: { venue: -0.25, rest: 0, matchup: 0.25, tempo: 0 } },
  ],
  NCAAB: [
    { id: 'ncaab-court', name: 'Campus Court Kings', mean: 123, stdDev: 16, scheduleFactors: { venue: 0.5, rest: 0.5, matchup: 0, tempo: 0.5 } },
    { id: 'ncaab-press', name: 'Full Court Press', mean: 118, stdDev: 15, scheduleFactors: { venue: 0, rest: -0.5, matchup: 0.5, tempo: 1 } },
    { id: 'ncaab-rim', name: 'March Rims', mean: 121, stdDev: 15, scheduleFactors: { venue: -0.5, rest: 0, matchup: -0.25, tempo: 0.25 } },
  ],
  NCAAF: [
    { id: 'ncaaf-option', name: 'Triple Option Co.', mean: 114, stdDev: 15, scheduleFactors: { venue: 0.5, rest: 0, matchup: 0.25, tempo: 0.5 } },
    { id: 'ncaaf-dynasty', name: 'Saturday Dynasty', mean: 110, stdDev: 16, scheduleFactors: { venue: 0, rest: 0.5, matchup: -0.25, tempo: -0.25 } },
    { id: 'ncaaf-uptempo', name: 'Up Tempo U', mean: 113, stdDev: 14, scheduleFactors: { venue: -0.5, rest: -0.5, matchup: 0.5, tempo: 1 } },
  ],
  SOCCER: [
    { id: 'soccer-pitch', name: 'Pitch Control FC', mean: 62, stdDev: 10, scheduleFactors: { venue: 0.5, rest: 0, matchup: 0.25, tempo: -0.25 } },
    { id: 'soccer-counter', name: 'Counter Attack XI', mean: 59, stdDev: 9, scheduleFactors: { venue: 0, rest: -0.5, matchup: 0.5, tempo: 0.5 } },
    { id: 'soccer-press', name: 'High Press City', mean: 61, stdDev: 9, scheduleFactors: { venue: -0.5, rest: 0.5, matchup: -0.25, tempo: 1 } },
  ],
}

const DEFAULT_SCHEDULE_FACTORS: Required<MatchupScheduleFactorsInput> = {
  venue: 0,
  rest: 0,
  matchup: 0,
  tempo: 0,
}

const SCHEDULE_FACTOR_OPTIONS = {
  venue: {
    negativeStrong: 'Road disadvantage',
    negativeSoft: 'Slight road drag',
    neutral: 'Neutral venue',
    positiveSoft: 'Mild home edge',
    positiveStrong: 'Strong home edge',
  },
  rest: {
    negativeStrong: 'Compressed schedule',
    negativeSoft: 'Short rest',
    neutral: 'Normal rest',
    positiveSoft: 'Extra recovery',
    positiveStrong: 'Ideal rest spot',
  },
  matchup: {
    negativeStrong: 'Elite opponent',
    negativeSoft: 'Tough matchup',
    neutral: 'Neutral matchup',
    positiveSoft: 'Favorable matchup',
    positiveStrong: 'Attack spot',
  },
  tempo: {
    negativeStrong: 'Low-event spot',
    negativeSoft: 'Slow environment',
    neutral: 'Balanced environment',
    positiveSoft: 'Fast environment',
    positiveStrong: 'Track-meet spot',
  },
} as const

/**
 * Options for sport selector (e.g. Simulation Lab, matchup simulator).
 */
export function getSportOptionsForSimulation(): SportOption[] {
  return SUPPORTED_SPORTS.map((s) => ({
    value: s,
    label: SPORT_LABELS[s] ?? s,
  }))
}

/**
 * Display label for a sport in simulation UI.
 */
function getSportLabel(sport: string): string {
  const normalized = normalizeToSupportedSport(sport)
  return SPORT_LABELS[normalized] ?? normalized
}

export function getSimulationTeamPresets(sport: string): SimulationTeamPreset[] {
  const normalized = normalizeToSupportedSport(sport)
  return SPORT_TEAM_PRESETS[normalized] ?? SPORT_TEAM_PRESETS.NFL
}

function buildFactorOptions(
  labels: (typeof SCHEDULE_FACTOR_OPTIONS)[keyof typeof SCHEDULE_FACTOR_OPTIONS]
) {
  return [
    { value: -1, label: labels.negativeStrong },
    { value: -0.5, label: labels.negativeSoft },
    { value: 0, label: labels.neutral },
    { value: 0.5, label: labels.positiveSoft },
    { value: 1, label: labels.positiveStrong },
  ]
}

export function getScheduleFactorDefinitionsForSport(
  sport: string
): SimulationScheduleFactorDefinition[] {
  const normalized = normalizeToSupportedSport(sport)
  const venueWord =
    normalized === 'NBA' || normalized === 'NCAAB'
      ? 'Floor'
      : normalized === 'NHL'
        ? 'Ice'
        : normalized === 'SOCCER'
          ? 'Pitch'
          : normalized === 'MLB'
            ? 'Park'
            : 'Field'

  return [
    {
      id: 'venue',
      label: `${venueWord} edge`,
      description: `Home/road leverage for this ${getSportLabel(normalized)} matchup.`,
      options: buildFactorOptions(SCHEDULE_FACTOR_OPTIONS.venue),
    },
    {
      id: 'rest',
      label: 'Schedule rest',
      description: 'How favorable the rest and travel window looks.',
      options: buildFactorOptions(SCHEDULE_FACTOR_OPTIONS.rest),
    },
    {
      id: 'matchup',
      label: 'Opponent quality',
      description: 'Difficulty of the opposing unit or defensive draw.',
      options: buildFactorOptions(SCHEDULE_FACTOR_OPTIONS.matchup),
    },
    {
      id: 'tempo',
      label: normalized === 'MLB' ? 'Run environment' : normalized === 'SOCCER' ? 'Game state' : 'Game environment',
      description: 'How much the pace or scoring environment should widen outcomes.',
      options: buildFactorOptions(SCHEDULE_FACTOR_OPTIONS.tempo),
    },
  ]
}

export function getDefaultScheduleFactorsForPreset(
  preset?: SimulationTeamPreset | null
): Required<MatchupScheduleFactorsInput> {
  return {
    ...DEFAULT_SCHEDULE_FACTORS,
    ...(preset?.scheduleFactors ?? {}),
  }
}

function roundToTenth(value: number): number {
  return Math.round(value * 10) / 10
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

export function buildLineupForSimulationPreset(
  sport: string,
  preset: SimulationTeamPreset
): MatchupLineupSlotInput[] {
  const slots = getPositionSlotsForSport(sport)
  const totalWeight =
    slots.reduce((sum, slot) => sum + getPositionSlotWeight(slot.id), 0) || 1

  const rawLineup = slots.map((slot, index) => {
    const weight = getPositionSlotWeight(slot.id)
    const allocation = weight / totalWeight
    const baseline = preset.mean * allocation
    const spread = Math.max(1.6, preset.stdDev * (0.45 + allocation))
    const projection = baseline + (slots.length - index) * 0.04
    const shortName = preset.name.split(' ').slice(0, 2).join(' ')
    return {
      slotId: slot.id,
      slotLabel: slot.label,
      playerName: `${shortName} ${slot.label}`,
      projection,
      floor: Math.max(0, projection - spread),
      ceiling: projection + spread,
      volatility: clamp(0.9 + (weight - 1) * 0.35, 0.7, 1.35),
    }
  })

  const totalProjection =
    rawLineup.reduce((sum, slot) => sum + slot.projection, 0) || preset.mean || 1
  const scale = preset.mean / totalProjection

  return rawLineup.map((slot) => ({
    ...slot,
    projection: roundToTenth(slot.projection * scale),
    floor: roundToTenth((slot.floor ?? slot.projection) * scale),
    ceiling: roundToTenth((slot.ceiling ?? slot.projection) * scale),
  }))
}

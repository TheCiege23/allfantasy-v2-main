import { isHealthyDesignation, isRuledOut } from '@/lib/core-app/injuryStatus'

export type AllFantasyProjectionSource =
  | 'allfantasy_snapshot'
  | 'provider_projection'
  | 'rolling_insights'
  | 'season_average'
  | 'adp_fallback'
  | 'missing'

export type AllFantasyProjectionConfidence = 'high' | 'medium' | 'low' | 'none'

export type AllFantasyProjectionInput = {
  playerId: string
  playerName: string
  sport: string
  position: string
  team?: string | null
  currentWeek?: number | null
  totalWeeks?: number | null
  byeWeek?: number | null
  injuryStatus?: string | null
  adp?: number | null
  providerWeeklyProjection?: number | null
  allFantasyWeeklyProjection?: number | null
  allFantasyConfidenceLevel?: string | null
  seasonAvgActual?: number | null
  rollingInsightsFantasyPointsPerGame?: number | null
  rollingInsightsGamesPlayed?: number | null
  rollingInsightsStats?: unknown
}

export type AllFantasyProjection = {
  playerId: string
  playerName: string
  sport: string
  position: string
  weeklyProjection: number | null
  restOfSeasonProjection: number | null
  floorProjection: number | null
  ceilingProjection: number | null
  confidenceScore: number
  confidenceLevel: AllFantasyProjectionConfidence
  source: AllFantasyProjectionSource
  basedOn: string[]
  reasons: string[]
  missingDataFlags: string[]
}

type Candidate = {
  value: number
  source: AllFantasyProjectionSource
  confidence: number
  label: string
}

const POSITION_BASELINES: Record<string, number> = {
  QB: 16.5,
  RB: 10.5,
  WR: 10,
  TE: 7.5,
  FLEX: 9,
  K: 7,
  PK: 7,
  DEF: 7.5,
  DST: 7.5,
  'D/ST': 7.5,
}

const POSITION_RANGE: Record<string, { floor: number; ceiling: number }> = {
  QB: { floor: 0.76, ceiling: 1.25 },
  RB: { floor: 0.62, ceiling: 1.48 },
  WR: { floor: 0.58, ceiling: 1.55 },
  TE: { floor: 0.52, ceiling: 1.62 },
  K: { floor: 0.5, ceiling: 1.42 },
  PK: { floor: 0.5, ceiling: 1.42 },
  DEF: { floor: 0.5, ceiling: 1.45 },
  DST: { floor: 0.5, ceiling: 1.45 },
  'D/ST': { floor: 0.5, ceiling: 1.45 },
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function toNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return null
}

function firstNumber(obj: unknown, keys: string[]): number | null {
  if (!isRecord(obj)) return null
  for (const key of keys) {
    const direct = toNumber(obj[key])
    if (direct != null) return direct
  }
  return null
}

function round1(value: number): number {
  return Math.round(value * 10) / 10
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function normalizePosition(position: string | null | undefined): string {
  const value = String(position ?? '').trim().toUpperCase()
  if (value === 'D/ST' || value === 'DEFENSE') return 'DST'
  if (value === 'PK') return 'K'
  return value || 'UNK'
}

function confidenceLevel(score: number): AllFantasyProjectionConfidence {
  if (score <= 0) return 'none'
  if (score >= 78) return 'high'
  if (score >= 58) return 'medium'
  return 'low'
}

function confidenceFromStoredLevel(level: string | null | undefined): number | null {
  const normalized = String(level ?? '').trim().toLowerCase()
  if (!normalized) return null
  if (normalized === 'high') return 88
  if (normalized === 'medium') return 74
  if (normalized === 'low') return 58
  if (normalized === 'unavailable') return 50
  return null
}

function adpToWeeklyProjection(adp: number, position: string): number {
  const pos = normalizePosition(position)
  const base = POSITION_BASELINES[pos] ?? 8
  const rankBoost = clamp((260 - adp) / 260, 0, 1)
  const premium =
    pos === 'QB'
      ? 8
      : pos === 'RB' || pos === 'WR'
        ? 7
        : pos === 'TE'
          ? 5
          : 3
  return round1(base + rankBoost * premium)
}

function rollingInsightsFppg(input: AllFantasyProjectionInput): number | null {
  const direct = toNumber(input.rollingInsightsFantasyPointsPerGame)
  if (direct != null) return direct
  const stats = input.rollingInsightsStats
  const topLevel = firstNumber(stats, [
    'fantasyPointsPerGame',
    'fantasy_points_per_game',
    'fantasy_points_avg',
    'fppg',
    'avgPoints',
    'avg_fp',
  ])
  if (topLevel != null) return topLevel
  if (isRecord(stats)) {
    const nested = firstNumber(stats.regularSeason, [
      'fantasyPointsPerGame',
      'fantasy_points_per_game',
      'fppg',
      'avgPoints',
    ])
    if (nested != null) return nested
  }
  return null
}

function rollingInsightsGames(input: AllFantasyProjectionInput): number | null {
  const direct = toNumber(input.rollingInsightsGamesPlayed)
  if (direct != null) return direct
  const stats = input.rollingInsightsStats
  return firstNumber(stats, ['gamesPlayed', 'games_played', 'games', 'gp'])
}

function pickCandidate(input: AllFantasyProjectionInput): Candidate | null {
  const af = toNumber(input.allFantasyWeeklyProjection)
  if (af != null) {
    return {
      value: af,
      source: 'allfantasy_snapshot',
      confidence: confidenceFromStoredLevel(input.allFantasyConfidenceLevel) ?? 84,
      label: 'AllFantasy cached projection',
    }
  }

  const provider = toNumber(input.providerWeeklyProjection)
  if (provider != null) {
    return {
      value: provider,
      source: 'provider_projection',
      confidence: 82,
      label: 'provider weekly projection',
    }
  }

  const ri = rollingInsightsFppg(input)
  if (ri != null) {
    return {
      value: ri,
      source: 'rolling_insights',
      confidence: 72,
      label: 'RollingInsights season FPPG',
    }
  }

  const seasonAvg = toNumber(input.seasonAvgActual)
  if (seasonAvg != null) {
    return {
      value: seasonAvg,
      source: 'season_average',
      confidence: 68,
      label: 'finalized season average',
    }
  }

  const adp = toNumber(input.adp)
  if (adp != null) {
    return {
      value: adpToWeeklyProjection(adp, input.position),
      source: 'adp_fallback',
      confidence: 52,
      label: 'ADP/ranking fallback',
    }
  }

  return null
}

/**
 * The words of a status, so a designation is matched as a WORD and never as a letter run inside one.
 *
 * ⚠ THIS WAS A SUBSTRING SCAN, AND TWO OF ITS NEEDLES ARE INSIDE ORDINARY WORDS (2026-10-11).
 * `includes('ir')` zeroed any status containing those two letters ("Virus", "Chair", "Dirt") and
 * `includes('out')` any containing "out" ("Without", "Workout"), so a Questionable player whose note
 * happened to spell one was projected as Out: zero this week, x0.62 rest of season. Absence is now
 * `isRuledOut` — the shared, tokenized rule (Out, IR/IL, PUP, NFI, suspension, injured reserve/list)
 * — and "no designation" is `isHealthyDesignation` (Active, ACT, NA, ...), so this engine and every
 * other availability reader agree on who is out.
 */
function statusWords(status: string): string[] {
  return status
    .toLowerCase()
    .replace(/\./g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)
}

function injuryProfile(status: string | null | undefined): {
  weeklyMultiplier: number
  rosMultiplier: number
  confidencePenalty: number
  reason: string | null
} {
  const normalized = String(status ?? '').trim().toLowerCase()
  if (!normalized || normalized === 'ok' || isHealthyDesignation(normalized)) {
    return { weeklyMultiplier: 1, rosMultiplier: 1, confidencePenalty: 0, reason: null }
  }
  const words = statusWords(normalized)
  // A game-day "Inactive" is an absence too (the NFL's 90-minute list), matched as a word.
  if (isRuledOut(status) || words.includes('inactive')) {
    return {
      weeklyMultiplier: 0,
      rosMultiplier: 0.62,
      confidencePenalty: 26,
      reason: `Listed ${status}; weekly projection reduced to zero.`,
    }
  }
  if (words.includes('doubtful') || normalized === 'd') {
    return {
      weeklyMultiplier: 0.35,
      rosMultiplier: 0.8,
      confidencePenalty: 18,
      reason: `Listed ${status}; availability risk sharply lowers this week.`,
    }
  }
  if (words.includes('questionable') || normalized === 'q') {
    return {
      weeklyMultiplier: 0.78,
      rosMultiplier: 0.92,
      confidencePenalty: 10,
      reason: `Listed ${status}; projection carries injury uncertainty.`,
    }
  }
  if (words.includes('probable')) {
    return {
      weeklyMultiplier: 0.94,
      rosMultiplier: 0.98,
      confidencePenalty: 4,
      reason: `Listed ${status}; small health discount applied.`,
    }
  }
  return {
    weeklyMultiplier: 0.88,
    rosMultiplier: 0.95,
    confidencePenalty: 7,
    reason: `Listed ${status}; projection carries status risk.`,
  }
}

export function buildAllFantasyProjection(input: AllFantasyProjectionInput): AllFantasyProjection {
  const position = normalizePosition(input.position)
  const candidate = pickCandidate(input)
  const missingDataFlags: string[] = []
  const reasons: string[] = []
  const basedOn: string[] = []

  if (!candidate) {
    return {
      playerId: input.playerId,
      playerName: input.playerName,
      sport: input.sport,
      position,
      weeklyProjection: null,
      restOfSeasonProjection: null,
      floorProjection: null,
      ceilingProjection: null,
      confidenceScore: 0,
      confidenceLevel: 'none',
      source: 'missing',
      basedOn: [],
      reasons: ['No projection, RollingInsights stat, season average, or ADP signal was available.'],
      missingDataFlags: ['Projection unavailable for this player.'],
    }
  }

  basedOn.push(candidate.label)
  const currentWeek = Math.max(1, Math.floor(Number(input.currentWeek ?? 1) || 1))
  const totalWeeks = Math.max(currentWeek, Math.floor(Number(input.totalWeeks ?? 17) || 17))
  let remainingWeeks = Math.max(1, totalWeeks - currentWeek + 1)
  const isByeWeek = input.byeWeek != null && Number(input.byeWeek) === currentWeek
  const injury = injuryProfile(input.injuryStatus)

  let weekly = Math.max(0, candidate.value)
  if (isByeWeek) {
    weekly = 0
    remainingWeeks = Math.max(0, remainingWeeks - 1)
    reasons.push(`Bye week ${currentWeek}; weekly projection set to zero.`)
  } else {
    weekly *= injury.weeklyMultiplier
  }

  if (injury.reason) reasons.push(injury.reason)

  const games = rollingInsightsGames(input)
  const range = POSITION_RANGE[position] ?? { floor: 0.58, ceiling: 1.5 }
  const confidencePenalty =
    injury.confidencePenalty +
    (isByeWeek ? 8 : 0) +
    (candidate.source === 'adp_fallback' ? 8 : 0) +
    (candidate.source === 'rolling_insights' && games != null && games > 0 && games < 3 ? 8 : 0)

  const sampleBonus =
    games != null && games >= 8
      ? 6
      : games != null && games >= 4
        ? 3
        : 0
  const confidenceScore = Math.round(clamp(candidate.confidence + sampleBonus - confidencePenalty, 1, 96))
  const confidence = confidenceLevel(confidenceScore)
  const confidenceSpread = confidence === 'high' ? 0 : confidence === 'medium' ? 0.08 : 0.16
  const floor = weekly > 0 ? weekly * Math.max(0.25, range.floor - confidenceSpread) : 0
  const ceiling = weekly > 0 ? weekly * (range.ceiling + confidenceSpread) : 0
  const rosBase = candidate.value * injury.rosMultiplier
  const ros = Math.max(0, rosBase * Math.max(0, remainingWeeks))

  if (candidate.source === 'adp_fallback') {
    missingDataFlags.push('Projection uses ADP/ranking fallback until provider stats are available.')
  }
  if (candidate.source === 'rolling_insights') {
    reasons.push('RollingInsights raw season data converted to weekly and rest-of-season projection.')
  }

  return {
    playerId: input.playerId,
    playerName: input.playerName,
    sport: input.sport,
    position,
    weeklyProjection: round1(weekly),
    restOfSeasonProjection: round1(ros),
    floorProjection: round1(floor),
    ceilingProjection: round1(ceiling),
    confidenceScore,
    confidenceLevel: confidence,
    source: candidate.source,
    basedOn,
    reasons,
    missingDataFlags,
  }
}

export function hasProjectionSignal(projection: AllFantasyProjection): boolean {
  return projection.source !== 'missing' && projection.weeklyProjection != null
}

/**
 * Phase 2C — League Difficulty Engine
 *
 * Pure compute. Given a `LeagueDifficultyInput`, returns a fully populated
 * `LeagueDifficultyRating` (shape lives in `lib/ranking/types.ts`).
 *
 * Hard rules:
 *   - No I/O.
 *   - No persisted state.
 *   - Every numeric constant comes from `./weights.ts`.
 *   - Output `effective` always clamped to `DIFFICULTY_SCORE_RANGE`.
 *   - Safe for missing/partial inputs — null fields collapse to neutral.
 *
 * Tuning belongs in `./weights.ts`. Tests should target dimensions, not raw
 * scalar outputs, so weight changes don't cascade into test churn.
 */

import type {
  LeagueDifficultyModifiers,
  LeagueDifficultyRating,
  RankingSport,
} from "@/lib/ranking/types"
import { NEUTRAL_DIFFICULTY_MODIFIERS } from "@/lib/ranking/types"
import {
  BASE_DIFFICULTY,
  CUSTOM_SCORING_BUMP,
  DIFFICULTY_SCORE_RANGE,
  DYNASTY_DEPTH,
  ELIMINATION_BUMP,
  LEAGUE_TYPE_MULTIPLIER,
  MODIFIER_CLAMPS,
  NEUTRAL_PLACEHOLDER,
  ROSTER_DEPTH,
  SCORING_COMPLEXITY_POINTS,
  SPORT_MULTIPLIER,
  TEAM_COUNT_BANDS,
  TRANSACTION_PRESSURE,
} from "@/lib/ranking/league-difficulty/weights"

type LeagueDifficultyInput = {
  leagueId: string
  sport?: RankingSport | string | null
  leagueType?: string | null
  scoring?: string | null
  teamCount?: number | null
  starterCount?: number | null
  benchSlots?: number | null
  taxiSlots?: number | null
  irSlots?: number | null
  rookiePickRounds?: number | null
  devySlots?: number | null
  superflex?: boolean | null
  tePremium?: boolean | null
  idp?: boolean | null
  customScoring?: boolean | null
  guillotine?: boolean | null
  survivor?: boolean | null
  bestBall?: boolean | null
  isDynasty?: boolean | null
  isKeeper?: boolean | null
  waiverType?: string | null

  /**
   * Optional pre-computed signals. Until Batch 3 wires them, callers leave
   * these undefined and the engine substitutes neutral 1.0.
   */
  opponentStrengthHint?: number | null
  activityHint?: number | null
}

type LeagueDifficultyBreakdown = {
  sportMultiplier: number
  leagueTypeMultiplier: number
  teamCountBonus: number
  rosterDepthBonus: number
  dynastyDepthBonus: number
  scoringComplexityPoints: number
  eliminationBump: number
  customScoringBump: number
  transactionPressure: number
}

function clamp(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min
  return Math.max(min, Math.min(max, n))
}

function norm(value?: string | null): string {
  return (value ?? "").toLowerCase().trim()
}

function pickSportMultiplier(sport?: string | null): number {
  const key = (sport ?? "").toString().toUpperCase()
  return SPORT_MULTIPLIER[key] ?? NEUTRAL_PLACEHOLDER
}

function pickLeagueTypeMultiplier(input: LeagueDifficultyInput): number {
  if (input.guillotine) return LEAGUE_TYPE_MULTIPLIER.guillotine
  if (input.survivor) return LEAGUE_TYPE_MULTIPLIER.survivor
  if (input.bestBall) return LEAGUE_TYPE_MULTIPLIER.bestball
  if (input.isDynasty) return LEAGUE_TYPE_MULTIPLIER.dynasty
  if (input.isKeeper) return LEAGUE_TYPE_MULTIPLIER.keeper

  const t = norm(input.leagueType)
  if (!t) return LEAGUE_TYPE_MULTIPLIER.redraft
  for (const [key, mult] of Object.entries(LEAGUE_TYPE_MULTIPLIER)) {
    if (t.includes(key)) return mult
  }
  return LEAGUE_TYPE_MULTIPLIER.redraft
}

function teamCountBonus(teamCount?: number | null): number {
  const n = Number(teamCount)
  if (!Number.isFinite(n) || n <= 0) return 0
  for (const band of TEAM_COUNT_BANDS) {
    if (n <= band.atMost) return band.bonus
  }
  return 0
}

function rosterDepthBonus(input: LeagueDifficultyInput): number {
  const starters = Number(input.starterCount)
  let extra = 0
  if (Number.isFinite(starters) && starters > ROSTER_DEPTH.baselineStarters) {
    extra += (starters - ROSTER_DEPTH.baselineStarters) * ROSTER_DEPTH.perExtraStarter
  }
  const taxi = Number(input.taxiSlots)
  if (Number.isFinite(taxi) && taxi > 0) extra += taxi * ROSTER_DEPTH.perTaxiSlot
  const ir = Number(input.irSlots)
  if (Number.isFinite(ir) && ir > 0) extra += ir * ROSTER_DEPTH.perIrSlot
  return extra
}

function dynastyDepthBonus(input: LeagueDifficultyInput): number {
  const isLongTerm =
    input.isDynasty === true ||
    input.isKeeper === true ||
    norm(input.leagueType).includes("devy")
  if (!isLongTerm) return 0
  let extra = 0
  const picks = Number(input.rookiePickRounds)
  if (Number.isFinite(picks) && picks > 0) extra += picks * DYNASTY_DEPTH.perRookiePickRound
  const devy = Number(input.devySlots)
  if (Number.isFinite(devy) && devy > 0) extra += devy * DYNASTY_DEPTH.perDevySlot
  return extra
}

function scoringComplexityPoints(input: LeagueDifficultyInput): number {
  const s = norm(input.scoring)
  let pts = 0
  if (s.includes("ppr") && !s.includes("half")) pts += SCORING_COMPLEXITY_POINTS.ppr
  if (s.includes("half")) pts += SCORING_COMPLEXITY_POINTS.halfPpr
  if (input.superflex || s.includes("superflex") || s.includes("2qb")) {
    pts += SCORING_COMPLEXITY_POINTS.superflex
  }
  if (input.tePremium || s.includes("te-premium") || s.includes("te premium")) {
    pts += SCORING_COMPLEXITY_POINTS.tePremium
  }
  if (input.idp || s.includes("idp")) pts += SCORING_COMPLEXITY_POINTS.idp
  if (input.customScoring) pts += SCORING_COMPLEXITY_POINTS.custom
  return pts
}

function eliminationBump(input: LeagueDifficultyInput): number {
  if (input.guillotine || input.survivor) return ELIMINATION_BUMP
  const t = norm(input.leagueType)
  if (t.includes("survivor") || t.includes("guillotine") || t.includes("big brother")) {
    return ELIMINATION_BUMP
  }
  return 0
}

function customScoringBump(input: LeagueDifficultyInput): number {
  return input.customScoring ? CUSTOM_SCORING_BUMP : 0
}

function transactionPressureMultiplier(waiverType?: string | null): number {
  const key = norm(waiverType)
  if (!key) return NEUTRAL_PLACEHOLDER
  return TRANSACTION_PRESSURE[key] ?? NEUTRAL_PLACEHOLDER
}

/**
 * Compose `LeagueDifficultyModifiers` from raw breakdown contributions.
 * Each modifier is clamped per `MODIFIER_CLAMPS`.
 */
function composeModifiers(breakdown: LeagueDifficultyBreakdown, input: LeagueDifficultyInput): LeagueDifficultyModifiers {
  const leagueTypeMultiplier = clamp(
    breakdown.leagueTypeMultiplier +
      breakdown.teamCountBonus +
      breakdown.rosterDepthBonus +
      breakdown.dynastyDepthBonus +
      breakdown.eliminationBump,
    MODIFIER_CLAMPS.leagueType.min,
    MODIFIER_CLAMPS.leagueType.max
  )
  const scoringComplexityModifier = clamp(
    1 + breakdown.scoringComplexityPoints + breakdown.customScoringBump,
    MODIFIER_CLAMPS.scoringComplexity.min,
    MODIFIER_CLAMPS.scoringComplexity.max
  )
  const opponentStrengthModifier = clamp(
    input.opponentStrengthHint ?? NEUTRAL_PLACEHOLDER,
    MODIFIER_CLAMPS.opponentStrength.min,
    MODIFIER_CLAMPS.opponentStrength.max
  )
  const activityModifier = clamp(
    (input.activityHint ?? NEUTRAL_PLACEHOLDER) * breakdown.transactionPressure,
    MODIFIER_CLAMPS.activity.min,
    MODIFIER_CLAMPS.activity.max
  )
  return {
    leagueTypeMultiplier,
    scoringComplexityModifier,
    opponentStrengthModifier,
    activityModifier,
  }
}

type LeagueDifficultyComputeResult = LeagueDifficultyRating & {
  breakdown: LeagueDifficultyBreakdown
}

export function computeLeagueDifficulty(
  input: LeagueDifficultyInput
): LeagueDifficultyComputeResult {
  const breakdown: LeagueDifficultyBreakdown = {
    sportMultiplier: pickSportMultiplier(input.sport),
    leagueTypeMultiplier: pickLeagueTypeMultiplier(input),
    teamCountBonus: teamCountBonus(input.teamCount),
    rosterDepthBonus: rosterDepthBonus(input),
    dynastyDepthBonus: dynastyDepthBonus(input),
    scoringComplexityPoints: scoringComplexityPoints(input),
    eliminationBump: eliminationBump(input),
    customScoringBump: customScoringBump(input),
    transactionPressure: transactionPressureMultiplier(input.waiverType),
  }

  const modifiers = composeModifiers(breakdown, input)
  const base = BASE_DIFFICULTY * breakdown.sportMultiplier
  const productOfModifiers =
    modifiers.leagueTypeMultiplier *
    modifiers.scoringComplexityModifier *
    modifiers.opponentStrengthModifier *
    modifiers.activityModifier
  const effective = clamp(
    base * productOfModifiers,
    DIFFICULTY_SCORE_RANGE.min,
    DIFFICULTY_SCORE_RANGE.max
  )

  return {
    leagueId: input.leagueId,
    base: clamp(base, DIFFICULTY_SCORE_RANGE.min, DIFFICULTY_SCORE_RANGE.max),
    modifiers,
    effective,
    breakdown,
  }
}

/** Neutral rating for callers that need a placeholder. */
export function neutralLeagueDifficulty(leagueId: string): LeagueDifficultyRating {
  return {
    leagueId,
    base: BASE_DIFFICULTY,
    modifiers: NEUTRAL_DIFFICULTY_MODIFIERS,
    effective: BASE_DIFFICULTY,
  }
}

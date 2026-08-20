/**
 * AF Projections — pure computation core.
 *
 * Every function here refuses rather than defaults. A missing input yields `null` or a
 * refusal, never a midpoint, a zero, or a league-average stand-in. That rule exists because
 * this codebase has already shipped the opposite twice: 43 synthetic projection rows that
 * joined to nothing, and a season aggregate stored in a column named `projections`.
 */

import type {
  ConfidenceInput,
  ConfidenceResult,
  DepthRole,
  ScoringFormat,
  SeasonAggregate,
  WeeklyObservation,
} from './types'

function finiteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && /^-?\d+(\.\d+)?$/.test(value.trim())) {
    const n = Number(value)
    return Number.isFinite(n) ? n : null
  }
  return null
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

/**
 * Pull the season aggregate out of a `FantasyStatLine.stats` payload.
 *
 * Shape (measured against the live RI ingest, 2026-08-11):
 *   { riTeam, position, riPlayerId, riPlayerName, postseason, regular_season: { … } }
 *
 * Components live under `regular_season`, NOT at the top level. This is the same nesting
 * that makes `extractProjectionPoints()` return null for `SportsPlayerRecord.projections` —
 * which is the only reason that dormant field is not currently presented as a forecast.
 * Read the nesting deliberately here; never teach a generic extractor to descend blindly.
 *
 * Returns null when `games_played` is missing or zero: every rate below divides by it, and a
 * player with no games has no per-game production to report.
 */
export function extractSeasonAggregate(statsJson: unknown): SeasonAggregate | null {
  const stats = asRecord(statsJson)
  if (!stats) return null

  const regular = asRecord(stats.regular_season)
  if (!regular) return null

  const gamesPlayed = finiteNumber(regular.games_played)
  if (gamesPlayed == null || gamesPlayed <= 0) return null

  const components: Record<string, number> = {}
  for (const [key, raw] of Object.entries(regular)) {
    const n = finiteNumber(raw)
    if (n != null) components[key] = n
  }

  const position = typeof stats.position === 'string' && stats.position.trim() ? stats.position.trim() : null
  const team = typeof stats.riTeam === 'string' && stats.riTeam.trim() ? stats.riTeam.trim() : null
  const playerName =
    typeof stats.riPlayerName === 'string' && stats.riPlayerName.trim() ? stats.riPlayerName.trim() : null

  return {
    gamesPlayed,
    components,
    position,
    team,
    playerName,
    dkPointsPerGame: finiteNumber(regular.DK_fantasy_points_per_game),
  }
}

/**
 * Per-game rates for every component. `games_played` itself is excluded — a "games per game"
 * rate is meaningless and would pollute any downstream component scoring.
 */
export function perGameRates(aggregate: SeasonAggregate): Record<string, number> {
  const out: Record<string, number> = {}
  for (const [key, total] of Object.entries(aggregate.components)) {
    if (key === 'games_played') continue
    out[key] = total / aggregate.gamesPlayed
  }
  return out
}

const POINTS_FIELD: Record<ScoringFormat, keyof WeeklyObservation> = {
  ppr: 'ptsPpr',
  half_ppr: 'ptsHalfPpr',
  std: 'ptsStd',
}

/**
 * Normalize one `PlayerGameStat.normalizedStatMap` into a `WeeklyObservation`.
 * Key vocabulary confirmed against 300 sampled NFL rows: `pts_ppr` / `pts_half_ppr` /
 * `pts_std` appear in 98%, `off_snp` in 77%, `tm_off_snp` in 89%, `rec_tgt` in 58%.
 */
export function toWeeklyObservation(week: number, statMap: unknown): WeeklyObservation | null {
  const m = asRecord(statMap)
  if (!m) return null
  return {
    week,
    ptsPpr: finiteNumber(m.pts_ppr),
    ptsHalfPpr: finiteNumber(m.pts_half_ppr),
    ptsStd: finiteNumber(m.pts_std),
    offSnaps: finiteNumber(m.off_snp),
    teamOffSnaps: finiteNumber(m.tm_off_snp),
    targets: finiteNumber(m.rec_tgt),
  }
}

export interface RecencyResult {
  value: number
  weeksUsed: number
  /** Weeks are weighted 0.5^(age/halfLife); carried so the caller can state it. */
  halfLife: number
}

/**
 * Recency-weighted mean of weekly points in the requested format.
 *
 * Recent weeks weigh more because role changes (a promotion to WR1, a new starting QB) show
 * up in recent usage and are invisible in a season total. Weeks where the player did not
 * record points in this format are EXCLUDED, not treated as zero — a null is "we have no
 * observation", while a real 0.0 (played, scored nothing) is kept and does drag the mean
 * down, which is correct.
 *
 * Returns null when no week carries a value in this format, so the caller can fall back or
 * refuse rather than average an empty set into NaN.
 */
export function recencyWeightedPoints(
  observations: WeeklyObservation[],
  format: ScoringFormat,
  halfLife = 4,
): RecencyResult | null {
  if (!observations.length || halfLife <= 0) return null

  const field = POINTS_FIELD[format]
  const usable = observations
    .filter((o) => finiteNumber(o[field]) != null)
    .sort((a, b) => a.week - b.week)
  if (!usable.length) return null

  const latestWeek = usable[usable.length - 1].week
  let weightedSum = 0
  let weightTotal = 0
  for (const o of usable) {
    const points = finiteNumber(o[field])
    if (points == null) continue
    const age = latestWeek - o.week
    const weight = Math.pow(0.5, age / halfLife)
    weightedSum += points * weight
    weightTotal += weight
  }
  if (weightTotal <= 0) return null

  return { value: weightedSum / weightTotal, weeksUsed: usable.length, halfLife }
}

/** Snap share across the observations that reported both player and team snaps. */
export function snapShare(observations: WeeklyObservation[]): number | null {
  let player = 0
  let team = 0
  for (const o of observations) {
    if (o.offSnaps != null && o.teamOffSnaps != null && o.teamOffSnaps > 0) {
      player += o.offSnaps
      team += o.teamOffSnaps
    }
  }
  return team > 0 ? player / team : null
}

/**
 * Parse an NFL depth-chart slot into an ordinal role. `WR2` -> 2, `RB` -> 1 (an unnumbered
 * skill slot is the top of its group), `LS`/`P`/`KR` -> no ordinal.
 */
const ORDINAL_SLOTS = /^(QB|RB|WR|TE|FB)(\d+)?$/i

export function parseDepthRole(slot: string | null | undefined): DepthRole | null {
  const s = String(slot ?? '').trim()
  if (!s) return null
  const m = ORDINAL_SLOTS.exec(s)
  if (!m) return { slot: s.toUpperCase(), ordinal: null }
  return { slot: s.toUpperCase(), ordinal: m[2] ? Number(m[2]) : 1 }
}

/**
 * Confidence derived from actual input coverage — never a constant, per the brief.
 *
 * The four signals are weighted by how much they reduce the chance of being wrong:
 * weekly observations matter most (they are the only within-season role signal, and they
 * reach only ~53% of players because `PlayerIdentityMap.sleeperId` is 53.1% populated),
 * then sample size, then depth role, then whether availability is even known.
 */
export function deriveConfidence(input: ConfidenceInput): ConfidenceResult {
  const reasons: string[] = []
  let score = 0

  // A projection FOR the target week is direct evidence, not inference. It is weighted
  // highest and, unlike the historical signals, does not decay with sample size — the
  // provider already did that work.
  if (input.hasForwardProjection) {
    score += 0.5
    reasons.push('provider projection for the target week')
  }

  // Weekly observations — up to 0.45, saturating at 8 weeks.
  if (input.weeklyWeeksUsed > 0) {
    const weeklyScore = 0.45 * Math.min(1, input.weeklyWeeksUsed / 8)
    score += weeklyScore
    reasons.push(`${input.weeklyWeeksUsed} weekly observation${input.weeklyWeeksUsed === 1 ? '' : 's'}`)
  } else {
    reasons.push('no weekly observations (player not matched to a Sleeper id)')
  }

  // Season sample size — up to 0.30, saturating at a 17-game season.
  const gamesScore = 0.3 * Math.min(1, input.gamesPlayed / 17)
  score += gamesScore
  reasons.push(`${input.gamesPlayed} game${input.gamesPlayed === 1 ? '' : 's'} in the season sample`)

  if (input.hasDepthRole) {
    score += 0.15
    reasons.push('depth-chart role known')
  } else {
    reasons.push('no depth-chart role')
  }

  if (input.hasInjuryStatus) {
    score += 0.1
    reasons.push('injury designation known')
  } else {
    // Absence of a designation is NOT health — it is absence of information.
    reasons.push('no injury designation on file (not a statement of health)')
  }

  if (input.basisIsPriorSeason) {
    score *= 0.85
    reasons.push('baseline is from a prior season')
  }

  const level: ConfidenceResult['level'] = score >= 0.7 ? 'high' : score >= 0.45 ? 'medium' : 'low'
  return { level, score: Math.round(score * 1000) / 1000, reasons }
}

/**
 * AF Projections — assemble a projection, or refuse.
 *
 * Pure. Every input is passed in; nothing is fetched. The caller (the writer, in the next
 * increment) is responsible for resolving ids across the three namespaces:
 *   FantasyStatLine -> canonical uuid, PlayerGameStat -> Sleeper id, DepthChart -> RI id.
 * `PlayerIdentityMap` carries rollingInsightsId for 1933/1933 NFL players but sleeperId for
 * only 1026 (53.1%), so `weekly` will legitimately be empty for about half the pool.
 */

import {
  deriveConfidence,
  extractSeasonAggregate,
  parseDepthRole,
  recencyWeightedPoints,
} from './core'
import { extractIdpComponents, isIdpEligiblePosition, scoreIdpComponents } from './idpScoring'
import type {
  IdpScoringBreakdown,
  ProjectionOutcome,
  ScoringFormat,
  SeasonAggregate,
  WeeklyObservation,
} from './types'

/** One week's raw stat map, needed for per-week IDP component scoring. */
/** Recency-weighted mean of each component amount, matching how points were weighted. */
function recencyWeightedComponents(
  perWeek: Array<{ week: number; breakdown: IdpScoringBreakdown }>,
  latestWeek: number,
  halfLife: number,
): Record<string, number> {
  const sums: Record<string, number> = {}
  let weightTotal = 0
  for (const p of perWeek) {
    const weight = Math.pow(0.5, (latestWeek - p.week) / halfLife)
    weightTotal += weight
    for (const [k, v] of Object.entries(p.breakdown.componentAmounts ?? {})) {
      sums[k] = (sums[k] ?? 0) + v * weight
    }
  }
  if (weightTotal <= 0) return {}
  const out: Record<string, number> = {}
  for (const [k, v] of Object.entries(sums)) out[k] = Math.round((v / weightTotal) * 1000) / 1000
  return out
}

export interface WeeklyRawStats {
  week: number
  statMap: Record<string, unknown>
}

/**
 * Score each week's IDP components under league rules, then recency-weight the resulting
 * per-week points. Scoring first and weighting second (rather than summing components and
 * scoring once) keeps a role change visible — a linebacker promoted to every-down work shows
 * up as recent high-point weeks.
 */
function scoreIdpWeekly(
  weeklyRaw: WeeklyRawStats[],
  rules: Record<string, number>,
  halfLife: number,
): { points: number; weeksUsed: number; breakdown: IdpScoringBreakdown } | null {
  const perWeek: Array<{ week: number; points: number; breakdown: IdpScoringBreakdown }> = []
  for (const w of weeklyRaw) {
    const extracted = extractIdpComponents(w.statMap, 'sleeper_weekly')
    const scored = scoreIdpComponents({ ...extracted, rules })
    if (scored) perWeek.push({ week: w.week, points: scored.points, breakdown: scored })
  }
  if (!perWeek.length) return null

  perWeek.sort((a, b) => a.week - b.week)
  const latest = perWeek[perWeek.length - 1].week
  let weightedSum = 0
  let weightTotal = 0
  for (const p of perWeek) {
    const weight = Math.pow(0.5, (latest - p.week) / halfLife)
    weightedSum += p.points * weight
    weightTotal += weight
  }
  if (weightTotal <= 0) return null

  const points = weightedSum / weightTotal
  if (points === 0) return null

  // Merge the per-week breakdowns: a week that needed the estimated tackle split taints the
  // whole projection, so the approximation must survive aggregation rather than be averaged away.
  const scoredComponents = [...new Set(perWeek.flatMap((p) => p.breakdown.scoredComponents))]
  const unscoredComponents = [...new Set(perWeek.flatMap((p) => p.breakdown.unscoredComponents))]
  const approximations = [...new Set(perWeek.flatMap((p) => p.breakdown.approximations))]

  return {
    points,
    weeksUsed: perWeek.length,
    breakdown: {
      points: Math.round(points * 100) / 100,
      // Recency-weight the AMOUNTS the same way the points were weighted, so a downstream
      // rescore under different league rules reproduces this projection's shape.
      componentAmounts: recencyWeightedComponents(perWeek, latest, halfLife),
      scoredComponents,
      unscoredComponents,
      approximations,
      usedMeasuredTackleSplit: approximations.length > 0,
    },
  }
}

export interface BuildProjectionInput {
  /** Raw `FantasyStatLine.stats` payload, or a pre-extracted aggregate. */
  statsJson?: unknown
  aggregate?: SeasonAggregate | null
  /** Weekly observations for THIS player. Empty when the Sleeper id was unmatched. */
  weekly?: WeeklyObservation[]
  /** Raw weekly stat maps, required for IDP component scoring. */
  weeklyRaw?: WeeklyRawStats[]
  /**
   * Sleeper's forward-looking projection for the target week, keyed by the same stat
   * vocabulary as the weekly logs. Present only when the player carries a `sleeperId`.
   */
  sleeperProjection?: Record<string, number> | null
  /**
   * League IDP scoring rules (stat key -> points), e.g. from `getIdpPresetScoring()`.
   * Omit for a league that does not score IDP — defenders will then correctly refuse rather
   * than receive points the league would never award.
   */
  idpRules?: Record<string, number> | null
  /**
   * Authoritative position, overriding whatever the season aggregate carries. Callers
   * should pass Sleeper's position when available: RI's is unreliable (it lists a Jaguars
   * WR as DE), and this value decides IDP eligibility.
   */
  position?: string | null
  /** Depth-chart slot, e.g. "WR2". */
  depthSlot?: string | null
  /**
   * Injury designation if one is on file. `null` means no designation is stated — which is
   * NOT a statement of health, and is treated purely as missing coverage.
   */
  injuryStatus?: string | null
  scoringFormat: ScoringFormat
  /** True when the baseline season precedes the season being projected. */
  basisIsPriorSeason: boolean
  /** Minimum games in the season sample before a projection may be emitted at all. */
  minGamesPlayed?: number
  recencyHalfLife?: number
}

const DEFAULT_MIN_GAMES = 2

/**
 * Returns a projection or a typed refusal. Never throws for missing data — absent inputs are
 * an expected outcome, and the refusal carries the reason so a caller can report it honestly
 * instead of rendering a blank.
 */
export function buildAfProjection(input: BuildProjectionInput): ProjectionOutcome {
  const aggregate =
    input.aggregate ?? (input.statsJson !== undefined ? extractSeasonAggregate(input.statsJson) : null)

  if (!aggregate) {
    return {
      ok: false,
      reason: 'no_games_played',
      detail: 'No season aggregate with a positive games_played could be extracted.',
    }
  }

  const minGames = input.minGamesPlayed ?? DEFAULT_MIN_GAMES
  if (aggregate.gamesPlayed < minGames) {
    return {
      ok: false,
      reason: 'insufficient_sample',
      detail: `Only ${aggregate.gamesPlayed} game(s) in the season sample; minimum is ${minGames}.`,
    }
  }

  const weekly = input.weekly ?? []
  const recency = recencyWeightedPoints(weekly, input.scoringFormat, input.recencyHalfLife ?? 4)

  // --- IDP paths, computed up front so the ladder below can compare them -------------
  // Gated on BOTH league rules and player position. Offensive players record tackles after
  // turnovers and on special teams, so without the position gate a quarterback with no DK
  // points falls through to IDP scoring and gets projected on defensive production.
  const effectivePosition = input.position ?? aggregate.position
  const idpRules = isIdpEligiblePosition(effectivePosition) ? input.idpRules ?? null : null
  let idpWeekly: { points: number; weeksUsed: number; breakdown: IdpScoringBreakdown } | null = null
  let idpSeason: { points: number; breakdown: IdpScoringBreakdown } | null = null

  if (idpRules) {
    idpWeekly = scoreIdpWeekly(input.weeklyRaw ?? [], idpRules, input.recencyHalfLife ?? 4)
    const seasonExtract = extractIdpComponents(aggregate.components, 'ri_season')
    const seasonScored = scoreIdpComponents({ ...seasonExtract, rules: idpRules })
    if (seasonScored && seasonScored.points !== 0) {
      // The season aggregate is a full-season TOTAL, so both the points and the component
      // amounts must be divided down to per-game. Dividing only the points (as this did
      // originally) left componentAmounts as season totals while afProjection was per-game,
      // and any downstream rescore then multiplied season counts by weekly weights —
      // measured: Kamren Curl stored 6.34/game rescored to 211.44, a ~17x inflation.
      // Everything persisted in the breakdown must share the per-game unit.
      const perGame = (n: number) => Math.round((n / aggregate.gamesPlayed) * 1000) / 1000
      const componentAmounts: Record<string, number> = {}
      for (const [k, v] of Object.entries(seasonScored.componentAmounts)) componentAmounts[k] = perGame(v)
      idpSeason = {
        points: seasonScored.points / aggregate.gamesPlayed,
        breakdown: {
          ...seasonScored,
          points: Math.round((seasonScored.points / aggregate.gamesPlayed) * 100) / 100,
          componentAmounts,
        },
      }
    }
  }

  // --- Sleeper forward-looking projection (tiers 1-2) --------------------------------
  // A projection FOR the week being played beats any inference from completed games, so
  // these sit above every historical tier.
  const proj = input.sleeperProjection ?? null
  const projFormatPoints = proj ? finite(proj[`pts_${input.scoringFormat}`]) : null

  let sleeperIdp: { points: number; breakdown: IdpScoringBreakdown } | null = null
  if (proj && idpRules) {
    const extracted = extractIdpComponents(proj, 'sleeper_weekly')
    const scored = scoreIdpComponents({ ...extracted, rules: idpRules })
    if (scored && scored.points !== 0) sleeperIdp = { points: scored.points, breakdown: scored }
  }

  // Basis precedence. Sleeper's forward-looking projection first, then real weekly actuals
  // in the requested format, then league-scored weekly IDP components, then a genuine zero,
  // then the DK season proxy, then season IDP.
  //
  // For an IDP-eligible player the component path is checked BEFORE `pts_{format}`: Sleeper's
  // points column is offensive-only, so a DE projected at ~11 IDP points reads 0.78 there.
  // Taking the points column for a defender would silently understate them ~14x.
  //
  // The `recency.value > 0` guard is load-bearing: Sleeper records `pts_ppr: 0` for many
  // defenders, so a naive "weekly beats everything" rule would project 0.0 for a linebacker
  // who scored real IDP points that week. A true zero is still honoured — just after the IDP
  // path has had its chance.
  let baselineProjection: number
  let basis: ProjectionOutcomeBasis
  let weeklyWeeksUsed = 0
  let idpBreakdown: IdpScoringBreakdown | null = null

  if (sleeperIdp) {
    baselineProjection = sleeperIdp.points
    basis = 'sleeper_weekly_idp_projection'
    idpBreakdown = sleeperIdp.breakdown
  } else if (projFormatPoints != null && projFormatPoints > 0) {
    baselineProjection = projFormatPoints
    basis = 'sleeper_weekly_projection'
  } else if (recency && recency.value > 0) {
    baselineProjection = recency.value
    basis = 'weekly_actuals_recency'
    weeklyWeeksUsed = recency.weeksUsed
  } else if (idpWeekly) {
    baselineProjection = idpWeekly.points
    basis = 'weekly_idp_components'
    weeklyWeeksUsed = idpWeekly.weeksUsed
    idpBreakdown = idpWeekly.breakdown
  } else if (recency) {
    baselineProjection = recency.value
    basis = 'weekly_actuals_recency'
    weeklyWeeksUsed = recency.weeksUsed
  } else if (aggregate.dkPointsPerGame != null) {
    baselineProjection = aggregate.dkPointsPerGame
    basis = 'season_dk_fppg_proxy'
  } else if (idpSeason) {
    baselineProjection = idpSeason.points
    basis = 'season_idp_components'
    idpBreakdown = idpSeason.breakdown
  } else {
    return {
      ok: false,
      reason: 'no_scoring_basis',
      detail:
        'No weekly points in the requested format, no scoreable IDP components, and no DraftKings points-per-game on the season aggregate.',
    }
  }

  const depthRole = parseDepthRole(input.depthSlot)

  const confidence = deriveConfidence({
    hasForwardProjection: basis === 'sleeper_weekly_projection' || basis === 'sleeper_weekly_idp_projection',
    gamesPlayed: aggregate.gamesPlayed,
    weeklyWeeksUsed,
    hasDepthRole: depthRole != null,
    hasInjuryStatus: Boolean(input.injuryStatus),
    basisIsPriorSeason: input.basisIsPriorSeason,
  })

  // No adjustments are applied in this increment. Saying so explicitly — rather than
  // emitting a plausible-looking reason string — is the point: `adjustmentReason` must name
  // adjustments that actually happened, so it stays null until opponent/weather/injury
  // layers land.
  const adjustmentsApplied: string[] = []
  const afProjection = baselineProjection

  const notes: string[] = []
  if (idpBreakdown?.approximations.length) {
    // An estimated tackle split must reach the reader, not stay buried in the breakdown.
    notes.push(...idpBreakdown.approximations)
  }
  if (idpBreakdown?.unscoredComponents.length) {
    notes.push(
      `Components present but not scored by this league: ${idpBreakdown.unscoredComponents.join(', ')}.`,
    )
  }
  if (basis === 'season_dk_fppg_proxy' && input.scoringFormat !== 'ppr') {
    // DraftKings NFL scoring is close to full PPR, so using it as a standard or half-PPR
    // baseline overstates receiving production. Stated, not silently corrected.
    notes.push(
      `Baseline is DraftKings points per game, which is close to full PPR — it overstates a ${input.scoringFormat} league.`,
    )
  }

  return {
    ok: true,
    baselineProjection: round2(baselineProjection),
    afProjection: round2(afProjection),
    basis,
    scoringFormat: input.scoringFormat,
    confidence: notes.length
      ? { ...confidence, reasons: [...confidence.reasons, ...notes] }
      : confidence,
    adjustmentsApplied,
    adjustmentReason: adjustmentsApplied.length ? adjustmentsApplied.join('; ') : null,
    weeklyWeeksUsed,
    idp: idpBreakdown,
  }
}

type ProjectionOutcomeBasis = Extract<ProjectionOutcome, { ok: true }>['basis']

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

function finite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

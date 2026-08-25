/**
 * IDP stat-line projection.
 *
 * Produces a projected per-game defensive component line for one player, in the vocabulary
 * `lib/projections/leagueScoring.ts` already resolves league scoring keys against. The
 * caller then prices it with `computeLeagueProjectedPoints` under the league's own settings.
 *
 * THE SHAPE OF THE MODEL, AND WHY.
 *
 *   Tackles are volume, not talent. They track snaps faced far more than they track a player
 *   being good, so they are projected from observed per-game rate and then scaled by the
 *   opponent's offensive pace — a defense facing a fast offense is simply on the field more.
 *
 *   Sacks and turnovers are low-frequency and regress hard. A pass rusher with three sacks in
 *   two weeks has not become a three-sack-a-week player, and projecting his recent streak
 *   forward is the single easiest way to produce a confident wrong number here. Those
 *   components are shrunk toward the position cohort's own mean, weighted by sample size.
 *
 * Pure: no prisma, no fetch, no clock.
 */

import { extractIdpComponents, type IdpComponent } from '@/lib/af-projections/idpScoring'
import { isIdpPosition } from '@/lib/core-app/scoringNotes'
import type {
  CohortPriors,
  IdpGameObservation,
  IdpProjectionOutcome,
  IdpStatKey,
  IdpStatLine,
  OpponentPace,
} from './types'

/**
 * Canonical component -> the output key the league scoring path consumes.
 *
 * The inverse of `SLEEPER_WEEKLY_KEYS` in af-projections. Extraction is reused rather than
 * reimplemented so the two modules cannot drift on what `idp_tkl` means; only the direction
 * of the mapping is local.
 */
const COMPONENT_TO_KEY: Partial<Record<IdpComponent, IdpStatKey>> = {
  soloTackle: 'idp_tkl_solo',
  assistTackle: 'idp_tkl_ast',
  sack: 'idp_sack',
  interception: 'idp_int',
  passDefended: 'idp_pass_def',
  forcedFumble: 'idp_ff',
  fumbleRecovery: 'idp_fum_rec',
  tackleForLoss: 'idp_tkl_loss',
  qbHit: 'idp_qb_hit',
  defensiveTd: 'idp_def_td',
  safety: 'idp_safe',
}

/**
 * Components whose volume genuinely scales with snaps faced, and so with opponent pace.
 *
 * Deliberately NOT the turnover keys. Pace puts a defender on the field more often, which
 * reliably produces more tackles; it does not make an interception more likely per snap in
 * any way this data can support, and scaling a turnover rate by tempo would be decoration.
 */
const PACE_SCALED: ReadonlySet<IdpStatKey> = new Set<IdpStatKey>([
  'idp_tkl_solo',
  'idp_tkl_ast',
  'idp_tkl_loss',
  'idp_qb_hit',
])

/**
 * Low-frequency components, regressed toward the cohort mean.
 *
 * Everything that is an EVENT rather than an accumulation. These are the components where a
 * two-game sample is noise and a naive recency weighting is actively harmful.
 */
const LOW_FREQUENCY: ReadonlySet<IdpStatKey> = new Set<IdpStatKey>([
  'idp_sack',
  'idp_int',
  'idp_pass_def',
  'idp_ff',
  'idp_fum_rec',
  'idp_def_td',
  'idp_safe',
])

export interface ProjectIdpStatLineInput {
  position: string | null | undefined
  /** Observed games, any order. Only defensive components are read. */
  history: readonly IdpGameObservation[]
  /** Opponent offensive pace for the week being projected. Omit when unknown. */
  opponentPace?: OpponentPace | null
  /** Cohort means for this position group. Omit to skip regression (and say so). */
  priors?: CohortPriors | null
  /** Depth-chart ordinal (`LB2` -> 2). Coverage/confidence signal only — see below. */
  depthOrdinal?: number | null
  /** Injury designation on file. Coverage signal only; the surface owns rule-outs. */
  injuryStatus?: string | null
  /** Minimum observed games before a projection may be emitted at all. */
  minGames?: number
  /** Recency half-life in weeks. Matches the 4-week half-life used elsewhere. */
  halfLifeWeeks?: number
  /**
   * Shrinkage strength for low-frequency events, in games.
   *
   * A player's own rate reaches half weight at this many games. Eight is deliberately
   * aggressive: across a 17-game season a sack rate is still mostly cohort information, and
   * the failure mode being prevented — a hot streak projected forward at full confidence —
   * is the one that puts an indefensible number on screen.
   */
  regressionPriorGames?: number
}

const DEFAULT_MIN_GAMES = 3
const DEFAULT_HALF_LIFE = 4
const DEFAULT_REGRESSION_PRIOR_GAMES = 8

/**
 * Pace multiplier bounds.
 *
 * Real season-long team pace spans roughly ±12% around the mean. Clamping at ±15% keeps a
 * thin or malformed pace row — a `secPerPlay` of 3, say — from silently doubling a
 * linebacker's tackle projection.
 */
const PACE_CLAMP_MIN = 0.85
const PACE_CLAMP_MAX = 1.15

/**
 * ⚠ STATED ON EVERY PROJECTION, WITHOUT EXCEPTION.
 *
 * Defensive snap share is the most predictive IDP input there is, and this codebase does not
 * persist it — `off_snp` / `tm_off_snp` are offensive. Volume below is inferred from observed
 * tackle counts and opponent pace instead, which is a materially weaker signal. A reader who
 * is not told that will reasonably assume otherwise.
 */
const NO_SNAP_DATA_NOTE =
  'No defensive snap-count data is persisted for this player, so usage is inferred from ' +
  'observed tackle volume and opponent pace rather than measured. Snap share is the ' +
  'strongest IDP signal and is absent here.'

function round3(n: number): number {
  return Math.round(n * 1000) / 1000
}

/** Recency-weighted mean of one series, newest game weighted highest. */
function weightedMean(
  samples: ReadonlyArray<{ index: number; value: number }>,
  latestIndex: number,
  halfLife: number,
): number | null {
  let sum = 0
  let weightTotal = 0
  for (const s of samples) {
    const w = Math.pow(0.5, (latestIndex - s.index) / halfLife)
    sum += s.value * w
    weightTotal += w
  }
  return weightTotal > 0 ? sum / weightTotal : null
}

export function projectIdpStatLine(input: ProjectIdpStatLineInput): IdpProjectionOutcome {
  const position = String(input.position ?? '').trim().toUpperCase()

  /*
   * The position gate is not a tidy-up. Offensive players record tackles after turnovers and
   * on special teams; af-projections measured 29 of them landing on an IDP basis, including
   * two quarterbacks. A quarterback must never carry a defensive projection.
   */
  if (!isIdpPosition(position)) {
    return {
      ok: false,
      reason: 'not_idp_position',
      detail: `Position ${position || '(none)'} is not an IDP position; no defensive projection applies.`,
    }
  }

  const history = [...input.history].sort((a, b) =>
    a.season !== b.season ? a.season - b.season : a.week - b.week,
  )
  if (history.length === 0) {
    return { ok: false, reason: 'no_history', detail: 'No game logs supplied for this player.' }
  }

  const minGames = input.minGames ?? DEFAULT_MIN_GAMES
  if (history.length < minGames) {
    return {
      ok: false,
      reason: 'insufficient_sample',
      detail: `Only ${history.length} game(s) of history; minimum is ${minGames}.`,
    }
  }

  const halfLife = input.halfLifeWeeks ?? DEFAULT_HALF_LIFE

  /*
   * Per-game component amounts, in output keys.
   *
   * Games are indexed by POSITION IN THE SEQUENCE, not by their own week number. History
   * legitimately spans seasons, and week 1 of the current season is more recent than week 17
   * of the previous one — decaying on the raw week field would weight last season's finish
   * above this season's opener.
   *
   * Extraction is delegated to af-projections so the combined-tackle key (`idp_tkl`, which
   * carries no solo/assist split) is interpreted by the one module that has measured that
   * split, rather than by a second guess here.
   */
  const series = new Map<IdpStatKey, Array<{ index: number; value: number }>>()

  history.forEach((g, index) => {
    const { components, combinedTackles } = extractIdpComponents(g.statMap, 'sleeper_weekly')

    const resolved: Partial<Record<IdpComponent, number>> = { ...components }
    /*
     * A combined count with no split is carried as solo rather than apportioned here.
     * Apportioning is a stated approximation owned by the scoring module that holds the
     * measured ratio; introducing a second split constant in this file is exactly how two
     * numbers that should agree stop agreeing.
     */
    if (
      combinedTackles != null &&
      combinedTackles > 0 &&
      resolved.soloTackle == null &&
      resolved.assistTackle == null
    ) {
      resolved.soloTackle = combinedTackles
    }

    for (const [component, amount] of Object.entries(resolved) as Array<[IdpComponent, number]>) {
      const key = COMPONENT_TO_KEY[component]
      if (!key || typeof amount !== 'number' || !Number.isFinite(amount)) continue
      const arr = series.get(key) ?? []
      arr.push({ index, value: amount })
      series.set(key, arr)
    }
  })

  if (series.size === 0) {
    return {
      ok: false,
      reason: 'no_defensive_production',
      detail:
        `${history.length} game(s) of history carry no defensive components at all. This is a ` +
        'data-coverage gap, not a projection of zero.',
    }
  }

  const latestIndex = history.length - 1
  const notes: string[] = [NO_SNAP_DATA_NOTE]

  // --- opponent pace -> defensive volume ---------------------------------------------
  let paceMultiplier = 1
  const pace = input.opponentPace ?? null
  if (pace && pace.secPerPlay > 0 && pace.leagueMeanSecPerPlay > 0) {
    /*
     * Lower seconds-per-play means a faster offense, more plays run against this defense, and
     * so more tackle opportunity — hence mean/opponent, not opponent/mean.
     */
    const raw = pace.leagueMeanSecPerPlay / pace.secPerPlay
    paceMultiplier = Math.min(PACE_CLAMP_MAX, Math.max(PACE_CLAMP_MIN, raw))
    const pct = Math.round((paceMultiplier - 1) * 1000) / 10
    if (pct !== 0) {
      notes.push(
        `Tackle volume adjusted ${pct > 0 ? '+' : ''}${pct}% for opponent pace ` +
          `(${pace.secPerPlay.toFixed(1)}s per play against a league mean of ` +
          `${pace.leagueMeanSecPerPlay.toFixed(1)}s).`,
      )
    }
  }

  // --- assemble the line --------------------------------------------------------------
  const priors = input.priors ?? null
  const k = input.regressionPriorGames ?? DEFAULT_REGRESSION_PRIOR_GAMES
  const n = history.length
  const statLine: IdpStatLine = {}
  let componentsObserved = 0
  let regressionApplied = false

  for (const [key, samples] of series) {
    const mean = weightedMean(samples, latestIndex, halfLife)
    if (mean == null) continue
    if (samples.some((s) => s.value !== 0)) componentsObserved++

    let value = mean

    if (LOW_FREQUENCY.has(key)) {
      const prior = priors?.perGame[key]
      if (typeof prior === 'number' && Number.isFinite(prior)) {
        // Shrink toward the cohort: the player's own rate reaches half weight at k games.
        const w = n / (n + k)
        value = value * w + prior * (1 - w)
        regressionApplied = true
      }
    } else if (PACE_SCALED.has(key)) {
      value *= paceMultiplier
    }

    if (value > 0) statLine[key] = round3(value)
  }

  if (Object.keys(statLine).length === 0) {
    return {
      ok: false,
      reason: 'no_defensive_production',
      detail:
        'Every projected component resolved to zero. Reported as an absence rather than as a ' +
        'projection of no production.',
    }
  }

  if (regressionApplied && priors) {
    notes.push(
      `Low-frequency events (sacks, turnovers) regressed toward the ${priors.position} cohort ` +
        `mean from ${priors.sampleGames} player-game(s); this player's own rate carries ` +
        `${Math.round((n / (n + k)) * 100)}% weight at ${n} game(s).`,
    )
  } else {
    notes.push(
      'No position-cohort priors were supplied, so sacks and turnovers are projected from this ' +
        "player's own sample alone and will overstate a recent streak.",
    )
  }

  // --- confidence, derived from coverage rather than asserted -------------------------
  const hasDepthRole = input.depthOrdinal != null
  const hasOpponentPace = pace != null
  /*
   * Sample size dominates on purpose. Four signals are counted, but a rich context around a
   * two-game sample is still a two-game sample, and the score has to say so.
   */
  const sampleScore = Math.min(1, n / 8)
  const breadthScore = Math.min(1, componentsObserved / 5)
  const contextScore = (hasDepthRole ? 0.5 : 0) + (hasOpponentPace ? 0.5 : 0)
  const confidenceScore =
    Math.round((sampleScore * 0.5 + breadthScore * 0.25 + contextScore * 0.25) * 100) / 100

  const confidence = confidenceScore >= 0.75 ? 'high' : confidenceScore >= 0.45 ? 'medium' : 'low'

  if (input.injuryStatus) {
    notes.push(
      `An injury designation of "${input.injuryStatus}" is on file. It is reported, not applied — ` +
        'this line is a healthy-usage projection.',
    )
  }
  if (input.depthOrdinal != null && input.depthOrdinal >= 3) {
    notes.push(
      `Depth chart lists this player at ordinal ${input.depthOrdinal}. Reserve defenders are ` +
        'projected from their own observed volume only; no role multiplier is applied because ' +
        'none is calibrated against snap data this codebase does not hold.',
    )
  }

  return {
    ok: true,
    statLine,
    basis: 'weighted_game_logs',
    confidence,
    confidenceScore,
    coverage: {
      gamesUsed: n,
      componentsObserved,
      hasDepthRole,
      hasOpponentPace,
      regressionApplied,
    },
    notes,
  }
}

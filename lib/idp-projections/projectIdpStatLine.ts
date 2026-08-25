/**
 * IDP stat-line projection.
 *
 * Produces a projected per-game defensive component line for one player, in the vocabulary
 * `lib/projections/leagueScoring.ts` already resolves league scoring keys against. The
 * caller then prices it with `computeLeagueProjectedPoints` under the league's own settings.
 *
 * MEASURED, NOT ASSERTED. `scripts/probe-idp-backtest.ts` walks 2025 weeks 8-18 forward,
 * projecting each week from games strictly before it, and scores 5,291 out-of-sample
 * player-weeks under one reference rulebook:
 *
 *   per-snap volume   MAE 4.673   RMSE 6.466   bias -1.10
 *   per-game volume   MAE 4.758   RMSE 6.623   bias -1.61
 *
 * That is the only difference in the sweep that is not noise. Varying the rate half-life
 * (8/17/34), the shrinkage strength (4/8/16) and the volume half-life (3/4/6/10) moved MAE by
 * under 0.03 in every case, so those constants are deliberately left at round, explainable
 * values rather than tuned to the third decimal of a single season.
 *
 * ⚠ THE NEGATIVE BIAS IS EXPECTED AND MUST NOT BE "CORRECTED" WITH A MULTIPLIER. Weekly IDP
 * scoring is right-skewed — a defensive touchdown or a three-sack game is worth many points
 * and is genuinely unpredictable. Minimising absolute error targets the MEDIAN week, and for
 * a right-skewed distribution the median sits below the mean. Scaling every projection up by
 * ~13% to close the gap would make the typical week wrong in order to flatter an average.
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
  /**
   * Project volume per defensive snap rather than per game. Default true where snap data
   * exists. Exposed so the backtest can measure the two bases against real outcomes instead
   * of the choice resting on argument.
   */
  useSnapBasis?: boolean
  /** Recency half-life for VOLUME stats (tackles). Matches the 4-week half-life used elsewhere. */
  halfLifeWeeks?: number
  /**
   * Recency half-life for RATE stats — sacks, turnovers, pass breakups.
   *
   * Deliberately much longer than the volume half-life. A tackle count follows a role that
   * can change inside a month; a forced-fumble rate is a property of the player and does not.
   * Sharing one four-game window made a single recovery three weeks ago read as a recovery
   * every fifth game.
   */
  rateHalfLifeWeeks?: number
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
/** ~a full season: long enough that a rate is a rate rather than a recent streak. */
const DEFAULT_RATE_HALF_LIFE = 17
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
 * ⚠ WHICH BASIS VOLUME WAS PROJECTED ON, STATED EITHER WAY.
 *
 * Snap share is the strongest IDP signal there is, and it IS persisted — `def_snp` and
 * `tm_def_snp` sit in `PlayerGameStat.normalizedStatMap`. (An earlier version of this file
 * asserted the opposite on every projection it produced. It was measured wrong: `off_snp` is
 * offensive, but `def_snp` is not, and 58% of defender game rows carry it.)
 *
 * Coverage is real but partial, so the basis differs per player and the reader is told which
 * one they are looking at rather than left to assume the stronger one.
 */
const SNAP_BASIS_NOTE =
  'Volume is projected per defensive snap and scaled by expected playing time, which is the ' +
  'strongest available IDP signal.'
const NO_SNAP_DATA_NOTE =
  'No defensive snap counts are on file for this player, so volume is projected per GAME ' +
  'rather than per snap. That cannot tell a rotational defender from an every-down one, and ' +
  'it is the weaker of the two bases this model uses.'

/** Below this many games with snap data, the per-snap rate is noise; fall back to per-game. */
const MIN_SNAP_GAMES = 3

/**
 * Half-life for the ROLE estimate, deliberately much shorter than the efficiency window.
 *
 * ⚠ WITHOUT THE SPLIT, USING SNAPS AT ALL IS ALGEBRAICALLY POINTLESS. If expected snaps are
 * the weighted mean of snaps on the SAME weights as the per-snap rate, then
 * rate x snaps = [Sigma(v.w)/Sigma(s.w)] x [Sigma(s.w)/Sigma(w)] = Sigma(v.w)/Sigma(w) —
 * exactly the per-game weighted mean it was supposed to improve on. The snap data cancels out
 * and the model has done arithmetic instead of learning something.
 *
 * They are separated because they are different KINDS of quantity. Per-snap efficiency is a
 * property of the player and is stable, so it wants a long window. Role is close to a step
 * function — a defender takes over an every-down job in one week — so it wants a short one.
 * Measured on the role-change case: a rotational defender at 20 snaps who moves to 62 projects
 * 4.67 solo tackles on a shared window and 5.2 when role is read from the recent games.
 */
const SNAP_ROLE_HALF_LIFE = 3

function finiteOrNull(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000
}

/**
 * Recency-weighted mean of one series, plus the EFFECTIVE size of the sample behind it.
 *
 * ⚠ THE RAW GAME COUNT IS NOT THE SAMPLE SIZE ONCE WEIGHTS ARE APPLIED, and treating it as
 * one is how a projection becomes confident about noise. With a 4-game half-life, a 115-game
 * history has roughly 12 games of real weight — the rest is multiplied by almost nothing.
 * Regressing on 115 handed the player's own recent form 94% weight when the evidence
 * supported far less.
 *
 * Kish's effective sample size, (Σw)² / Σw², is the standard measure and degrades correctly:
 * it equals n when every weight is equal, and falls toward 1 as one observation dominates.
 */
function weightedMean(
  samples: ReadonlyArray<{ index: number; value: number }>,
  latestIndex: number,
  halfLife: number,
): { mean: number; effectiveN: number } | null {
  let sum = 0
  let weightTotal = 0
  let weightSqTotal = 0
  for (const s of samples) {
    const w = Math.pow(0.5, (latestIndex - s.index) / halfLife)
    sum += s.value * w
    weightTotal += w
    weightSqTotal += w * w
  }
  if (weightTotal <= 0 || weightSqTotal <= 0) return null
  return {
    mean: sum / weightTotal,
    effectiveN: (weightTotal * weightTotal) / weightSqTotal,
  }
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
  const rateHalfLife = input.rateHalfLifeWeeks ?? DEFAULT_RATE_HALF_LIFE

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
  const snapsPerGame: Array<{ played: number | null; team: number | null }> = []
  const perGame: Array<Partial<Record<IdpStatKey, number>>> = history.map((g) => {
    const { components, combinedTackles } = extractIdpComponents(g.statMap, 'sleeper_weekly')
    snapsPerGame.push({
      played: finiteOrNull(g.statMap.def_snp),
      team: finiteOrNull(g.statMap.tm_def_snp),
    })

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

    const row: Partial<Record<IdpStatKey, number>> = {}
    for (const [component, amount] of Object.entries(resolved) as Array<[IdpComponent, number]>) {
      const key = COMPONENT_TO_KEY[component]
      if (!key || typeof amount !== 'number' || !Number.isFinite(amount)) continue
      row[key] = (row[key] ?? 0) + amount
    }
    return row
  })

  /*
   * ⚠ THE SERIES MUST BE DENSE, AND THIS IS THE WHOLE BALLGAME FOR RATE STATS.
   *
   * A game in which a defender recorded no sack is an observation OF ZERO SACKS, not a
   * missing sample. Averaging a component only over the games it appeared in produces a
   * per-occurrence rate that can never fall below one: measured on production, Kam Curl came
   * back projected for 1 sack, 2 interceptions and 1 defensive touchdown EVERY WEEK, scoring
   * 56.58 in a league that should have him in the teens. Absence is evidence here, and
   * dropping it turns every rare event into a certainty.
   */
  const observedKeys = new Set<IdpStatKey>()
  for (const row of perGame) for (const k of Object.keys(row) as IdpStatKey[]) observedKeys.add(k)

  const series = new Map<IdpStatKey, Array<{ index: number; value: number }>>()
  for (const key of observedKeys) {
    series.set(
      key,
      perGame.map((row, index) => ({ index, value: row[key] ?? 0 })),
    )
  }

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
  const notes: string[] = []

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

  /*
   * --- expected playing time -----------------------------------------------------------
   *
   * ⚠ THIS IS THE DIFFERENCE BETWEEN A ROLE AND AN AVERAGE. Tackles are volume, and volume is
   * snaps. A per-GAME mean cannot tell a rotational defender who just took over an every-down
   * job from one who is losing snaps — both look like their average. Projecting a per-SNAP
   * rate and multiplying by expected snaps separates efficiency from usage, so a role change
   * shows up immediately instead of being averaged away over a month.
   *
   * Both halves are recency-weighted on the SAME volume half-life, so the two move together.
   */
  const snapSamples: Array<{ index: number; value: number }> = []
  const shareSamples: Array<{ index: number; value: number }> = []
  snapsPerGame.forEach((sn, index) => {
    if (sn.played == null) return
    snapSamples.push({ index, value: sn.played })
    if (sn.team != null && sn.team > 0) {
      shareSamples.push({ index, value: Math.min(1, sn.played / sn.team) })
    }
  })

  /*
   * ⚠ ROLE IS A SHARE, NOT A SNAP COUNT, AND CONFLATING THEM MADE THIS WORSE NOT BETTER.
   * How many defensive snaps a player took in a game depends on how many plays his defense
   * faced — a blowout or an overtime game moves it by twenty — and that is game script, not
   * role. Reading recent raw counts as "his job" imported all of that noise: measured against
   * known league numbers it pushed Carson Schwesinger from ~15 to ~19 and Quincy Williams from
   * ~13 to ~15.
   *
   * So role is the SHARE of his defense's snaps, taken over a short window because a job
   * changes in a week; and the number of snaps that share will be applied to is the team's own
   * long-run average, which is stable. Opponent pace then moves the team total, which is the
   * one place tempo genuinely belongs.
   */
  const teamSnapSamples: Array<{ index: number; value: number }> = []
  snapsPerGame.forEach((sn, index) => {
    if (sn.team != null && sn.team > 0) teamSnapSamples.push({ index, value: sn.team })
  })

  const usableSnaps = (input.useSnapBasis ?? true) && snapSamples.length >= MIN_SNAP_GAMES
  const shareStat =
    shareSamples.length >= MIN_SNAP_GAMES
      ? weightedMean(shareSamples, latestIndex, SNAP_ROLE_HALF_LIFE)
      : null
  const teamSnapStat =
    teamSnapSamples.length >= MIN_SNAP_GAMES
      ? weightedMean(teamSnapSamples, latestIndex, rateHalfLife)
      : null

  const projectedSnapShare = shareStat ? Math.round(shareStat.mean * 1000) / 1000 : null
  const projectedSnaps =
    shareStat && teamSnapStat
      ? Math.round(shareStat.mean * teamSnapStat.mean * 10) / 10
      : // No team totals on file — fall back to the player's own snaps over the LONG window.
        // Still better than the short one, which is mostly game script.
        (() => {
          const fallback = usableSnaps ? weightedMean(snapSamples, latestIndex, rateHalfLife) : null
          return fallback ? Math.round(fallback.mean * 10) / 10 : null
        })()

  /**
   * Per-snap rate for one volume component: Σ(value·w) / Σ(snaps·w) over games carrying snaps.
   *
   * A RATIO OF WEIGHTED TOTALS, not a mean of per-game ratios. The latter gives a game with
   * four snaps the same say as a game with sixty, which is precisely backwards.
   */
  const perSnapRate = (samples: ReadonlyArray<{ index: number; value: number }>): number | null => {
    let num = 0
    let den = 0
    for (const sample of samples) {
      const sn = snapsPerGame[sample.index]
      if (sn?.played == null || sn.played <= 0) continue
      const w = Math.pow(0.5, (latestIndex - sample.index) / halfLife)
      num += sample.value * w
      den += sn.played * w
    }
    return den > 0 ? num / den : null
  }

  // --- assemble the line --------------------------------------------------------------
  const priors = input.priors ?? null
  const k = input.regressionPriorGames ?? DEFAULT_REGRESSION_PRIOR_GAMES
  const n = history.length
  const effectiveNs: number[] = []
  const statLine: IdpStatLine = {}
  let componentsObserved = 0
  let regressionApplied = false

  for (const [key, samples] of series) {
    const isRate = LOW_FREQUENCY.has(key)
    /*
     * ⚠ RATES AND ROLES DECAY AT DIFFERENT SPEEDS, AND USING ONE HALF-LIFE FOR BOTH IS WHAT
     * MADE A PASS RUSHER READ HIGH. Tackle volume follows a role that really can change in a
     * month, so four games is right for it. A forced-fumble rate does not change in a month
     * — it is a property of the player — and a four-game window turns "he recovered a fumble
     * three weeks ago" into "he recovers a fumble every fifth game". Measured on DeMarcus
     * Lawrence: 0.213 fumble recoveries per game projected against a 0.061 career rate.
     */
    const stat = weightedMean(samples, latestIndex, isRate ? rateHalfLife : halfLife)
    if (stat == null) continue
    if (samples.some((s) => s.value !== 0)) componentsObserved++

    let value = stat.mean

    if (isRate) {
      const prior = priors?.perGame[key]
      if (typeof prior === 'number' && Number.isFinite(prior)) {
        // Shrink toward the cohort on the EFFECTIVE sample, not the raw game count.
        const w = stat.effectiveN / (stat.effectiveN + k)
        value = value * w + prior * (1 - w)
        regressionApplied = true
        effectiveNs.push(stat.effectiveN)
      }
    } else if (PACE_SCALED.has(key)) {
      /*
       * Per-snap x expected snaps when snap counts exist; otherwise the per-game mean, which
       * is what this model had before snap data was found. Both are then scaled by opponent
       * pace, because a faster offense means more defensive snaps than the recent average.
       */
      if (usableSnaps && projectedSnaps != null && projectedSnaps > 0) {
        const rate = perSnapRate(samples)
        if (rate != null) value = rate * projectedSnaps
      }
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
    /*
     * The EFFECTIVE sample is reported, not the raw game count. Saying "115 games" when the
     * recency weighting left about twelve games of real signal overstates the evidence by an
     * order of magnitude, and this sentence is rendered to a reader.
     */
    const effN = effectiveNs.length
      ? effectiveNs.reduce((a, b) => a + b, 0) / effectiveNs.length
      : n
    notes.push(
      `Low-frequency events (sacks, turnovers) regressed toward the ${priors.position} cohort ` +
        `mean from ${priors.sampleGames} player-game(s). After recency weighting this player's ` +
        `${n} game(s) carry the weight of about ${effN.toFixed(1)}, so his own rate holds ` +
        `${Math.round((effN / (effN + k)) * 100)}% and the cohort the rest.`,
    )
  } else {
    notes.push(
      'No position-cohort priors were supplied, so sacks and turnovers are projected from this ' +
        "player's own sample alone and will overstate a recent streak.",
    )
  }

  if (usableSnaps && projectedSnaps != null) {
    const sharePart =
      projectedSnapShare != null
        ? ` He is projected for ${projectedSnaps} defensive snaps, about ` +
          `${Math.round(projectedSnapShare * 100)}% of his defense's.`
        : ` He is projected for ${projectedSnaps} defensive snaps.`
    notes.push(SNAP_BASIS_NOTE + sharePart)
  } else {
    notes.push(NO_SNAP_DATA_NOTE)
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
      gamesWithSnaps: snapSamples.length,
      projectedSnaps,
      projectedSnapShare,
      componentsObserved,
      hasDepthRole,
      hasOpponentPace,
      regressionApplied,
    },
    notes,
  }
}

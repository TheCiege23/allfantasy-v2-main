/**
 * Opponent adjustment — how a player has actually fared against this defense.
 *
 * The premise, and it is a sound one: if a player has played well against Denver
 * and badly against New England, that belongs in next week's projection. The
 * difficulty is not whether the effect is real; it is that the raw split is
 * computed on very few games and will happily produce a confident number from
 * almost nothing.
 *
 * Two guards make it honest, and neither is optional:
 *
 *   SHRINKAGE   The observed effect is pulled toward zero in proportion to how
 *               little evidence supports it — the standard empirical-Bayes move,
 *               and what every credible projection system does with small-sample
 *               rates. One game against a defense moves a projection barely at
 *               all; ten games move it most of the way.
 *
 *   RECENCY     A 2019 game is weak evidence about a 2026 defense. Personnel and
 *               coordinators turn over, so older games are down-weighted by an
 *               exponential decay rather than averaged in as equals.
 *
 * Everything this module returns carries its own sample size and the weight that
 * was applied, because an adjustment a caller cannot inspect is an adjustment a
 * caller cannot honestly display.
 */

export type OpponentGame = {
  season: number
  fantasyPoints: number
}

export type OpponentAdjustment = {
  /** Points to add to the baseline. Can be negative. */
  points: number
  /** Games actually found against this defense. */
  sampleSize: number
  /** Effective (recency-weighted) sample size — always <= sampleSize. */
  effectiveSampleSize: number
  /** The unshrunk difference, for display alongside the shrunk one. */
  rawEffect: number
  /** 0–1. How much of `rawEffect` survived shrinkage. */
  confidence: number
  /** Plain-language explanation, safe to show a user. */
  reason: string
}

/**
 * Shrinkage constant, in games.
 *
 * ⚠ TUNED FOR HOW OFTEN THE MATCHUP ACTUALLY HAPPENS, NOT PICKED FOR FEEL. A
 * divisional opponent recurs twice a season; everyone else roughly once every
 * three years. At k = 6 the weights land where the evidence does:
 *
 *   n = 1  → 0.14   a single game barely moves anything
 *   n = 2  → 0.25   one divisional season, still mostly baseline
 *   n = 6  → 0.50   three divisional seasons, half credit
 *   n = 12 → 0.67   six seasons of a rivalry, most of the effect
 *
 * Lowering k would let one hot game masquerade as a read on a matchup.
 */
const SHRINKAGE_GAMES = 6

/**
 * Per-season recency decay.
 *
 * A game one season old counts 0.75; three seasons old, 0.42; six seasons, 0.18.
 * Defenses are rebuilt over that span, so old evidence should fade rather than
 * be discarded on an arbitrary cutoff — a cliff would make a projection jump the
 * day a season rolls over.
 */
const RECENCY_DECAY = 0.75

/** Cap on how far this single factor may move a projection, in points. */
const MAX_ABS_ADJUSTMENT = 4

function weightFor(gameSeason: number, currentSeason: number): number {
  const age = Math.max(0, currentSeason - gameSeason)
  return Math.pow(RECENCY_DECAY, age)
}

/**
 * Compute the adjustment for one player against one defense.
 *
 * `baselineAverage` is the player's own typical output — the thing the opponent
 * effect is measured RELATIVE to. Passing a league-wide average instead would
 * turn this into "is this player better than average", which is not what the
 * caller is asking and would double-count the player's own quality.
 */
export function computeOpponentAdjustment(args: {
  gamesVsOpponent: OpponentGame[]
  baselineAverage: number
  currentSeason: number
  opponentLabel?: string
}): OpponentAdjustment {
  const { gamesVsOpponent, baselineAverage, currentSeason } = args
  const label = args.opponentLabel ?? 'this defense'

  if (gamesVsOpponent.length === 0) {
    /*
     * ⚠ NOT "no effect" — NO EVIDENCE. These are different claims and the reason
     * string must not blur them. A zero adjustment presented as a finding implies
     * we looked and found the matchup neutral; in fact we have never seen this
     * player face this defense.
     */
    return {
      points: 0,
      sampleSize: 0,
      effectiveSampleSize: 0,
      rawEffect: 0,
      confidence: 0,
      reason: `no games on file against ${label}`,
    }
  }

  let weightSum = 0
  let weightedPoints = 0
  for (const g of gamesVsOpponent) {
    const w = weightFor(g.season, currentSeason)
    weightSum += w
    weightedPoints += w * g.fantasyPoints
  }

  // Guard against a pathological all-zero weight set (every game absurdly old).
  if (weightSum <= 0) {
    return {
      points: 0,
      sampleSize: gamesVsOpponent.length,
      effectiveSampleSize: 0,
      rawEffect: 0,
      confidence: 0,
      reason: `games against ${label} are too old to carry weight`,
    }
  }

  const weightedAverage = weightedPoints / weightSum
  const rawEffect = weightedAverage - baselineAverage

  // Shrink on the EFFECTIVE sample, so six ancient games cannot buy the
  // confidence of six recent ones.
  const effectiveN = weightSum
  const confidence = effectiveN / (effectiveN + SHRINKAGE_GAMES)
  const shrunk = rawEffect * confidence

  const points = Math.max(-MAX_ABS_ADJUSTMENT, Math.min(MAX_ABS_ADJUSTMENT, shrunk))

  const direction = points >= 0 ? 'above' : 'below'
  const reason =
    `${gamesVsOpponent.length} game${gamesVsOpponent.length === 1 ? '' : 's'} against ${label}: ` +
    `${weightedAverage.toFixed(1)} pts vs a ${baselineAverage.toFixed(1)} baseline ` +
    `(${Math.abs(rawEffect).toFixed(1)} ${direction}, ${Math.round(confidence * 100)}% weight applied)`

  return {
    points: Math.round(points * 100) / 100,
    sampleSize: gamesVsOpponent.length,
    effectiveSampleSize: Math.round(effectiveN * 100) / 100,
    rawEffect: Math.round(rawEffect * 100) / 100,
    confidence: Math.round(confidence * 100) / 100,
    reason,
  }
}

/**
 * Defense-vs-position: what this defense has allowed to players at this position.
 *
 * ⚠ THE LARGER-SAMPLE COMPANION TO THE ABOVE, AND USUALLY THE STRONGER SIGNAL.
 * "This player vs this defense" is n=1–2; "every WR who faced this defense this
 * season" is n in the dozens. The first is what a user asks for; the second is
 * what actually predicts. Both are computed and both are shown, rather than
 * letting the smaller, more intuitive number stand alone.
 */
export function computeDefenseVsPositionAdjustment(args: {
  /** Fantasy points this defense allowed to the position, one entry per game. */
  allowedToPosition: number[]
  /** League-wide average allowed to that position over the same span. */
  leagueAverageAllowed: number
  positionLabel?: string
  opponentLabel?: string
}): OpponentAdjustment {
  const { allowedToPosition, leagueAverageAllowed } = args
  const pos = args.positionLabel ?? 'this position'
  const label = args.opponentLabel ?? 'this defense'

  if (allowedToPosition.length === 0 || leagueAverageAllowed <= 0) {
    return {
      points: 0,
      sampleSize: 0,
      effectiveSampleSize: 0,
      rawEffect: 0,
      confidence: 0,
      reason: `nothing on file for what ${label} allows to ${pos}`,
    }
  }

  const n = allowedToPosition.length
  const avg = allowedToPosition.reduce((a, b) => a + b, 0) / n
  const rawEffect = avg - leagueAverageAllowed
  const confidence = n / (n + SHRINKAGE_GAMES)
  const points = Math.max(
    -MAX_ABS_ADJUSTMENT,
    Math.min(MAX_ABS_ADJUSTMENT, rawEffect * confidence)
  )

  return {
    points: Math.round(points * 100) / 100,
    sampleSize: n,
    effectiveSampleSize: n,
    rawEffect: Math.round(rawEffect * 100) / 100,
    confidence: Math.round(confidence * 100) / 100,
    reason:
      `${label} allows ${avg.toFixed(1)} to ${pos} across ${n} games ` +
      `(league average ${leagueAverageAllowed.toFixed(1)})`,
  }
}

/**
 * Month-of-season effect.
 *
 * ⚠ DELIBERATELY THE WEAKEST LEVER HERE, AND CAPPED HARDER THAN THE OTHERS.
 * "Plays badly in December" is one of fantasy's most repeated claims and one of
 * its least supported: a player has at most 4–5 December games a season, and the
 * split is confounded by weather, opponent strength and playoff-rest decisions —
 * all of which this model already handles elsewhere. Keeping the cap low stops
 * the same underlying effect being counted three times.
 */
const MAX_MONTH_ADJUSTMENT = 1.5

export function computeMonthAdjustment(args: {
  gamesInMonth: OpponentGame[]
  baselineAverage: number
  currentSeason: number
  monthLabel?: string
}): OpponentAdjustment {
  const { gamesInMonth, baselineAverage, currentSeason } = args
  const label = args.monthLabel ?? 'this month'

  if (gamesInMonth.length === 0) {
    return {
      points: 0,
      sampleSize: 0,
      effectiveSampleSize: 0,
      rawEffect: 0,
      confidence: 0,
      reason: `no games on file in ${label}`,
    }
  }

  let weightSum = 0
  let weighted = 0
  for (const g of gamesInMonth) {
    const w = weightFor(g.season, currentSeason)
    weightSum += w
    weighted += w * g.fantasyPoints
  }
  if (weightSum <= 0) {
    return {
      points: 0,
      sampleSize: gamesInMonth.length,
      effectiveSampleSize: 0,
      rawEffect: 0,
      confidence: 0,
      reason: `${label} games are too old to carry weight`,
    }
  }

  const avg = weighted / weightSum
  const rawEffect = avg - baselineAverage
  const confidence = weightSum / (weightSum + SHRINKAGE_GAMES * 2)
  const points = Math.max(
    -MAX_MONTH_ADJUSTMENT,
    Math.min(MAX_MONTH_ADJUSTMENT, rawEffect * confidence)
  )

  return {
    points: Math.round(points * 100) / 100,
    sampleSize: gamesInMonth.length,
    effectiveSampleSize: Math.round(weightSum * 100) / 100,
    rawEffect: Math.round(rawEffect * 100) / 100,
    confidence: Math.round(confidence * 100) / 100,
    reason: `${gamesInMonth.length} games in ${label}: ${avg.toFixed(1)} vs ${baselineAverage.toFixed(1)} baseline`,
  }
}

/**
 * In-game win probability for a real (not fantasy) football game.
 *
 * ⚠ THIS IS OUR OWN ESTIMATE, AND EVERY SURFACE THAT RENDERS IT MUST SAY SO.
 * No connected feed supplies a game win probability — not ESPN's scoreboard, not
 * Rolling Insights, not TheSportsDB, CFBD or API-Sports. This module computes one
 * rather than leaving the design element empty, which means the number is a MODEL
 * OUTPUT and not a reported fact. Labelling it is not a nicety: an unlabelled
 * percentage next to feed-sourced scores reads as equally authoritative, and it
 * is not.
 *
 * THE MODEL
 * Treat the rest of the game as a random walk on the score margin. The final
 * margin is the current margin plus whatever scoring is still to come, and that
 * remaining scoring is modelled as Normal(0, sigma^2 * t) where `t` is the
 * fraction of the game left. Home team wins when the final margin is positive:
 *
 *     P(home) = Phi( (margin + hfa * t) / (sigma * sqrt(t)) )
 *
 * `sigma` is the standard deviation of a full NFL game's final margin (~13.5
 * points, stable across recent seasons). Scaling it by sqrt(t) is the standard
 * Brownian assumption: variance accumulates linearly in time, so the standard
 * deviation accumulates in its square root. Home-field advantage is applied only
 * to the portion of the game still unplayed — a 2-point edge is worth nothing
 * with ten seconds left.
 *
 * WHAT IT DELIBERATELY DOES NOT KNOW
 * Possession, down and distance, timeouts, field position, and whether the
 * leading team is simply kneeling out the clock. A team up 3 with the ball on the
 * opponent's 20 and a team up 3 defending its own 5 get the same number here, and
 * they are not the same game. It is therefore least accurate exactly where fans
 * look hardest — the final two minutes of a one-score game.
 *
 * ⚠ IT REFUSES RATHER THAN GUESSES. Without a period AND a clock there is no `t`,
 * so `estimateWinProbability` returns null and callers render nothing. A
 * confident 50/50 for a game we cannot time is indistinguishable on screen from a
 * real coin-flip finish.
 */

/** Standard deviation of an NFL game's final score margin, in points. */
export const MARGIN_STDDEV = 13.5

/** Home-field advantage in points, applied pro-rata over the remaining game. */
export const HOME_FIELD_ADVANTAGE = 1.8

const REGULATION_PERIODS = 4
const PERIOD_SECONDS = 15 * 60
const REGULATION_SECONDS = REGULATION_PERIODS * PERIOD_SECONDS

export type WinProbabilityInput = {
  homeScore: number | null
  awayScore: number | null
  /** 1-4 in regulation; >4 is overtime. */
  period: number | null
  /** ESPN's displayClock, "8:42" — time remaining IN THE PERIOD. */
  clock: string | null
  completed: boolean
}

export type WinProbability = {
  home: number
  away: number
  /** Always true here. Present so a consumer can never render this unlabelled by accident. */
  isEstimate: true
}

/** "8:42" -> 522. Returns null for anything that is not a clock. */
export function parseClockSeconds(clock: string | null | undefined): number | null {
  const raw = String(clock ?? '').trim()
  if (!raw) return null
  const m = raw.match(/^(\d{1,2}):(\d{2})$/)
  if (!m) return null
  const minutes = Number(m[1])
  const seconds = Number(m[2])
  if (!Number.isFinite(minutes) || !Number.isFinite(seconds) || seconds >= 60) return null
  return minutes * 60 + seconds
}

/**
 * Fraction of regulation still to play, in [0, 1].
 *
 * Overtime returns a small positive floor rather than 0: the game is genuinely
 * undecided, and a zero would make `sigma * sqrt(t)` zero and force the result to
 * a certain 0 or 1 for a game still being played.
 */
export function fractionRemaining(period: number | null, clockSeconds: number | null): number | null {
  if (period == null || period < 1) return null
  if (clockSeconds == null) return null
  if (period > REGULATION_PERIODS) {
    // ~10 minutes of overtime, expressed against the regulation baseline.
    return Math.max(clockSeconds / REGULATION_SECONDS, 0.01)
  }
  const periodsLeftAfterThis = REGULATION_PERIODS - period
  const secondsRemaining = periodsLeftAfterThis * PERIOD_SECONDS + clockSeconds
  return Math.min(Math.max(secondsRemaining / REGULATION_SECONDS, 0), 1)
}

/**
 * Standard normal CDF via the Abramowitz & Stegun 7.1.26 erf approximation
 * (|error| < 1.5e-7) — ample for a number rendered as a whole percentage.
 */
function normalCdf(z: number): number {
  const sign = z < 0 ? -1 : 1
  const x = Math.abs(z) / Math.SQRT2
  const t = 1 / (1 + 0.3275911 * x)
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-x * x)
  return 0.5 * (1 + sign * y)
}

/** Round a probability pair to whole percents that still sum to 100. */
function asPercentPair(home: number): { home: number; away: number } {
  const h = Math.round(home * 100)
  const clamped = Math.min(Math.max(h, 1), 99)
  return { home: clamped, away: 100 - clamped }
}

/**
 * Estimate win probability, or null when the game cannot be timed.
 *
 * A completed game is not an estimate at all — it is the result — so it returns
 * a definite 100/0 (or null on a tie, which has no winner to report).
 */
export function estimateWinProbability(input: WinProbabilityInput): WinProbability | null {
  const { homeScore, awayScore } = input
  if (homeScore == null || awayScore == null) return null
  const margin = homeScore - awayScore

  if (input.completed) {
    if (margin === 0) return null
    return { ...asPercentPair(margin > 0 ? 1 : 0), isEstimate: true }
  }

  const t = fractionRemaining(input.period, parseClockSeconds(input.clock))
  if (t == null) return null

  // Kickoff: no time has elapsed, so the margin carries no information and the
  // whole estimate is home-field advantage.
  const effectiveT = Math.max(t, 0.01)
  const z = (margin + HOME_FIELD_ADVANTAGE * effectiveT) / (MARGIN_STDDEV * Math.sqrt(effectiveT))
  return { ...asPercentPair(normalCdf(z)), isEstimate: true }
}

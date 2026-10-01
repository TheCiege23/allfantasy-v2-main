/**
 * Glicko-2 — the per-game skill rating behind the manager class.
 *
 * Pure arithmetic: no prisma, no `server-only`. Implements Glickman,
 * "Example of the Glicko-2 system" (2012), steps 1–8, with one rating period
 * per fantasy week.
 *
 * ── WHY GLICKO-2 AND NOT ELO ─────────────────────────────────────────────────
 * Elo has one number. Glicko-2 carries a second — the rating deviation (RD), how
 * sure we are — and that is the thing a class system needs most:
 *   - a manager with eight games and a manager with three hundred can both read
 *     1650, and only the RD says which of those is known
 *   - beating a strong opponent moves you more than beating a weak one, so
 *     "who you played" is finally part of the number (the career score cannot
 *     measure opponent quality — see lib/core-app/rankingsEngine.ts)
 *   - RD grows back while a manager sits out, so a returning player moves fast
 *     until the system has re-measured them
 *
 * ── WHAT A "GAME" IS ─────────────────────────────────────────────────────────
 * One head-to-head fantasy matchup: 1 for a win, 0 for a loss, 0.5 for a tie.
 * The margin is deliberately ignored — points scale differs across sports and
 * scoring formats, and a rating that rewards running up the score rewards the
 * format, not the manager.
 */

/* ──────────────────────────────── constants ─────────────────────────────── */

/** Display scale: a new manager starts here. */
export const GLICKO_DEFAULT_RATING = 1500
/** A new manager's deviation — "we know nothing yet". Also the ceiling RD regrows to. */
export const GLICKO_DEFAULT_RD = 350
export const GLICKO_DEFAULT_VOLATILITY = 0.06
/** Constrains volatility change. Glickman suggests 0.3–1.2; small is conservative. */
export const GLICKO_TAU = 0.5
/** Glicko-2's internal scale factor. */
const SCALE = 173.7178
const CONVERGENCE = 0.000001

export type GlickoRating = {
  rating: number
  rd: number
  volatility: number
}

export type GameScore = 0 | 0.5 | 1

export type PeriodResult = {
  opponent: GlickoRating
  score: GameScore
}

export function newRating(): GlickoRating {
  return { rating: GLICKO_DEFAULT_RATING, rd: GLICKO_DEFAULT_RD, volatility: GLICKO_DEFAULT_VOLATILITY }
}

/* ───────────────────────────────── maths ─────────────────────────────────── */

const toMu = (r: number) => (r - GLICKO_DEFAULT_RATING) / SCALE
const toPhi = (rd: number) => rd / SCALE
const fromMu = (mu: number) => mu * SCALE + GLICKO_DEFAULT_RATING
const fromPhi = (phi: number) => phi * SCALE

function g(phi: number): number {
  return 1 / Math.sqrt(1 + (3 * phi * phi) / (Math.PI * Math.PI))
}

function expected(mu: number, muJ: number, phiJ: number): number {
  return 1 / (1 + Math.exp(-g(phiJ) * (mu - muJ)))
}

/** Probability that `a` beats `b`, accounting for both deviations. */
export function winProbability(a: GlickoRating, b: GlickoRating): number {
  const phi = Math.sqrt(toPhi(a.rd) ** 2 + toPhi(b.rd) ** 2)
  return 1 / (1 + Math.exp(-g(phi) * (toMu(a.rating) - toMu(b.rating))))
}

/** Step 5: the new volatility, by the Illinois algorithm. */
function newVolatility(phi: number, sigma: number, delta: number, v: number, tau: number): number {
  const a = Math.log(sigma * sigma)
  const f = (x: number) => {
    const ex = Math.exp(x)
    const d = phi * phi + v + ex
    return (ex * (delta * delta - phi * phi - v - ex)) / (2 * d * d) - (x - a) / (tau * tau)
  }
  let A = a
  let B: number
  if (delta * delta > phi * phi + v) {
    B = Math.log(delta * delta - phi * phi - v)
  } else {
    let k = 1
    while (f(a - k * tau) < 0) k += 1
    B = a - k * tau
  }
  let fA = f(A)
  let fB = f(B)
  let guard = 0
  while (Math.abs(B - A) > CONVERGENCE && guard < 200) {
    const C = A + ((A - B) * fA) / (fB - fA)
    const fC = f(C)
    if (fC * fB <= 0) {
      A = B
      fA = fB
    } else {
      fA = fA / 2
    }
    B = C
    fB = fC
    guard += 1
  }
  return Math.exp(A / 2)
}

/**
 * One rating period for one manager. `results` are every game they played in
 * the period, each against the opponent's rating as it stood at the START of
 * the period — Glicko-2 updates everyone in a period simultaneously.
 *
 * With no results the rating and volatility hold and only the deviation grows
 * (step 6 alone): an idle manager becomes less certain, not better or worse.
 */
export function ratePeriod(player: GlickoRating, results: PeriodResult[], tau = GLICKO_TAU): GlickoRating {
  const mu = toMu(player.rating)
  const phi = toPhi(player.rd)
  const sigma = player.volatility

  if (results.length === 0) {
    const phiStar = Math.sqrt(phi * phi + sigma * sigma)
    return { rating: player.rating, rd: Math.min(GLICKO_DEFAULT_RD, fromPhi(phiStar)), volatility: sigma }
  }

  let vInv = 0
  let deltaSum = 0
  for (const r of results) {
    const muJ = toMu(r.opponent.rating)
    const phiJ = toPhi(r.opponent.rd)
    const gJ = g(phiJ)
    const E = expected(mu, muJ, phiJ)
    vInv += gJ * gJ * E * (1 - E)
    deltaSum += gJ * (r.score - E)
  }
  const v = 1 / vInv
  const delta = v * deltaSum

  const sigmaNew = newVolatility(phi, sigma, delta, v, tau)
  const phiStar = Math.sqrt(phi * phi + sigmaNew * sigmaNew)
  const phiNew = 1 / Math.sqrt(1 / (phiStar * phiStar) + 1 / v)
  const muNew = mu + phiNew * phiNew * deltaSum

  return {
    rating: fromMu(muNew),
    rd: Math.min(GLICKO_DEFAULT_RD, fromPhi(phiNew)),
    volatility: sigmaNew,
  }
}

/**
 * Idle periods between a manager's games. Each one grows the deviation by the
 * volatility, capped at the starting RD — an offseason makes the system less
 * sure of you, never more.
 */
export function decay(player: GlickoRating, idlePeriods: number): GlickoRating {
  if (idlePeriods <= 0) return player
  const phi = toPhi(player.rd)
  const phiStar = Math.sqrt(phi * phi + idlePeriods * player.volatility * player.volatility)
  return { ...player, rd: Math.min(GLICKO_DEFAULT_RD, fromPhi(phiStar)) }
}

/**
 * A conservative single number for ordering and for the class band: the rating
 * minus two deviations. A manager the system barely knows sits low until
 * games prove otherwise, so nobody climbs a class on a lucky handful of weeks.
 */
export function conservativeRating(r: GlickoRating): number {
  return r.rating - 2 * r.rd
}

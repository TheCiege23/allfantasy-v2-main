/**
 * The Class rating engine — the pure half of ADR F2.10a.
 *
 * No prisma, no I/O: matchup rows in, ratings and a game log out, so the whole method
 * is unit-tested directly (including against Glickman's own worked example) and the
 * writer, the read layer and any future back-test quote one set of constants.
 *
 * ── WHAT IS RATED ────────────────────────────────────────────────────────────────
 *
 * All-play Glicko-2 (ADR F2.10a, rule 1). A rating period is one NFL week. Each person
 * contributes ONE observation per league-week: their all-play share — teams beaten plus
 * half the teams tied, over the other teams in the league that week — against a virtual
 * opponent at the mean rating of the rest of that league. Head-to-head results are kept
 * for the game log but do not move the rating: the back-test (2026-10-01) found all-play
 * better on every measure (Brier .2368 vs .2462), because it strips out who you happened
 * to be scheduled against.
 *
 * ⚠ ONE OBSERVATION PER LEAGUE-WEEK, NOT ELEVEN. Feeding each of the eleven all-play
 * comparisons in as its own game would count one week eleven times and shrink the
 * uncertainty eleven times too fast. The share is a fractional score on one game.
 */

export const CLASS_MODEL_VERSION = 'allplay-glicko2-v1'

export const GLICKO = {
  /** Glicko-2 internal scale ↔ the 1500 display scale. */
  scale: 173.7178,
  tau: 0.5,
  startRd: 350,
  startSigma: 0.06,
  /** Idle steps applied to everyone at each season boundary. */
  offseasonIdleSteps: 8,
  /** A rating at or under this RD is established — it defines percentiles and is gated. */
  establishedRd: 100,
  /** League-weeks with fewer teams are skipped: all-play over 2–3 teams is mostly noise. */
  minLeagueTeams: 4,
} as const

export const CLASS_COUNT = 25
export const DIVISION_COUNT = 5
export const CLASSES_PER_DIVISION = CLASS_COUNT / DIVISION_COUNT

/* ──────────────────────────────── types ──────────────────────────────── */

/** One completed head-to-head game between two rated people, in one league-week. */
export type RatingGame = {
  leagueId: string
  season: number
  week: number
  /** Subject keys, `${platform}:${platformUserId}`. Never equal. */
  a: string
  b: string
  scoreA: number
  scoreB: number
}

/** Internal Glicko-2 state (μ, φ on the internal scale). */
export type RatingState = {
  mu: number
  phi: number
  sigma: number
  /** Rated league-weeks. */
  games: number
  /** Last period folded in, season * 100 + week. */
  lastPeriod: number | null
}

export type RatingEvent = {
  subjectKey: string
  leagueId: string
  season: number
  week: number
  pointsFor: number
  allPlayWins: number
  allPlayGames: number
  opponentKey: string | null
  pointsAgainst: number | null
  result: 'W' | 'L' | 'T' | null
  /** The week's rating before and after — shared by every league that week. */
  ratingBefore: number
  ratingAfter: number
  rdAfter: number
  /** This league's share of the week's move; the shares sum to ratingAfter − ratingBefore. */
  ratingDelta: number
}

export type ClassifiedRating = {
  rating: number
  rd: number
  volatility: number
  games: number
  lastPeriod: number | null
  established: boolean
  /** Share of established ratings strictly below this one. Null while provisional. */
  percentile: number | null
  classLevel: number | null
  division: number | null
}

/* ─────────────────────────────── Glicko-2 ─────────────────────────────── */

const g = (phi: number) => 1 / Math.sqrt(1 + (3 * phi * phi) / (Math.PI * Math.PI))
const expected = (mu: number, muj: number, phij: number) => 1 / (1 + Math.exp(-g(phij) * (mu - muj)))

export type Observation = { muj: number; phij: number; s: number }

export function newRating(): RatingState {
  return { mu: 0, phi: GLICKO.startRd / GLICKO.scale, sigma: GLICKO.startSigma, games: 0, lastPeriod: null }
}

/** Glicko-2 step 5: the new volatility, by the Illinois algorithm (Glickman 2013). */
function newVolatility(phi: number, sigma: number, delta: number, v: number): number {
  const a = Math.log(sigma * sigma)
  const phi2 = phi * phi
  const tau2 = GLICKO.tau * GLICKO.tau
  const f = (x: number) => {
    const ex = Math.exp(x)
    return (ex * (delta * delta - phi2 - v - ex)) / (2 * (phi2 + v + ex) ** 2) - (x - a) / tau2
  }
  let A = a
  let B: number
  if (delta * delta > phi2 + v) B = Math.log(delta * delta - phi2 - v)
  else {
    let k = 1
    while (f(a - k * GLICKO.tau) < 0) k++
    B = a - k * GLICKO.tau
  }
  let fA = f(A)
  let fB = f(B)
  for (let i = 0; i < 100 && Math.abs(B - A) > 1e-6; i++) {
    const C = A + ((A - B) * fA) / (fB - fA)
    const fC = f(C)
    if (fC * fB <= 0) {
      A = B
      fA = fB
    } else fA /= 2
    B = C
    fB = fC
  }
  return Math.exp(A / 2)
}

/** One rating period with no games: only the uncertainty grows, capped at the start value. */
export function idle(p: RatingState): RatingState {
  const phi = Math.min(Math.sqrt(p.phi * p.phi + p.sigma * p.sigma), GLICKO.startRd / GLICKO.scale)
  return { ...p, phi }
}

/**
 * One Glicko-2 rating period. Returns the new state and, per observation, its share of
 * the change in μ (internal scale) — the shares sum exactly to `next.mu − p.mu`, which is
 * what lets the game log attribute a week's move to the leagues that caused it.
 */
export function glicko2Update(p: RatingState, obs: Observation[]): { next: RatingState; shares: number[] } {
  if (obs.length === 0) return { next: idle(p), shares: [] }
  let vinv = 0
  const terms: number[] = []
  for (const o of obs) {
    const e = expected(p.mu, o.muj, o.phij)
    const gj = g(o.phij)
    vinv += gj * gj * e * (1 - e)
    terms.push(gj * (o.s - e))
  }
  const v = 1 / vinv
  const sum = terms.reduce((s, t) => s + t, 0)
  const sigma = newVolatility(p.phi, p.sigma, v * sum, v)
  const phiStar = Math.sqrt(p.phi * p.phi + sigma * sigma)
  const phi = 1 / Math.sqrt(1 / (phiStar * phiStar) + 1 / v)
  const shares = terms.map((t) => phi * phi * t)
  const mu = p.mu + shares.reduce((s, t) => s + t, 0)
  return { next: { ...p, mu, phi, sigma, games: p.games + obs.length }, shares }
}

export const toDisplay = (mu: number) => 1500 + mu * GLICKO.scale
export const rdOf = (phi: number) => phi * GLICKO.scale

/* ──────────────────────────────── replay ──────────────────────────────── */

type Team = { key: string; pts: number }

/** The teams of one league-week, each person once, in first-seen order. */
function leagueWeekTeams(games: RatingGame[]): Team[] {
  const out: Team[] = []
  const seen = new Set<string>()
  for (const gm of games) {
    if (!seen.has(gm.a)) {
      seen.add(gm.a)
      out.push({ key: gm.a, pts: gm.scoreA })
    }
    if (!seen.has(gm.b)) {
      seen.add(gm.b)
      out.push({ key: gm.b, pts: gm.scoreB })
    }
  }
  return out
}

const nextTick = () => new Promise<void>((resolve) => setImmediate(resolve))

/**
 * Replay every game in period order and return the final ratings and the game log.
 *
 * Deterministic: the same games in any input order give the same result, because games
 * are grouped by period and league and every period updates from PRE-period ratings.
 *
 * `yieldEveryPeriods` hands the event loop back between periods. The worker runs every
 * route on one core, and a replay that never yields stalls all of them for its duration.
 */
export async function replay(
  games: RatingGame[],
  opts: { yieldEveryPeriods?: number } = {},
): Promise<{ ratings: Map<string, RatingState>; events: RatingEvent[] }> {
  const byPeriod = new Map<number, Map<string, RatingGame[]>>()
  for (const gm of games) {
    if (gm.a === gm.b) continue
    const period = gm.season * 100 + gm.week
    const leagues = byPeriod.get(period) ?? new Map<string, RatingGame[]>()
    const list = leagues.get(gm.leagueId) ?? []
    list.push(gm)
    leagues.set(gm.leagueId, list)
    byPeriod.set(period, leagues)
  }
  const periods = [...byPeriod.keys()].sort((x, y) => x - y)

  const R = new Map<string, RatingState>()
  const get = (key: string) => R.get(key) ?? newRating()
  const events: RatingEvent[] = []
  let lastSeason: number | null = null
  let n = 0

  for (const period of periods) {
    const season = Math.floor(period / 100)
    const week = period % 100
    if (lastSeason != null && season !== lastSeason) {
      for (const [key, p] of R) {
        let q = p
        for (let i = 0; i < GLICKO.offseasonIdleSteps; i++) q = idle(q)
        R.set(key, q)
      }
    }
    lastSeason = season

    // Observations from PRE-period ratings, with the league-week each came from.
    const obs = new Map<string, Array<{ o: Observation; leagueId: string; team: Team; wins: number; others: number }>>()
    const h2h = new Map<string, { opp: string; pf: number; pa: number }>()
    const leagueIds = [...byPeriod.get(period)!.keys()].sort()
    for (const leagueId of leagueIds) {
      const lgGames = byPeriod.get(period)!.get(leagueId)!
      for (const gm of lgGames) {
        const lg = `${leagueId}|`
        h2h.set(lg + gm.a, { opp: gm.b, pf: gm.scoreA, pa: gm.scoreB })
        h2h.set(lg + gm.b, { opp: gm.a, pf: gm.scoreB, pa: gm.scoreA })
      }
      const teams = leagueWeekTeams(lgGames)
      if (teams.length < GLICKO.minLeagueTeams) continue
      for (const me of teams) {
        let wins = 0
        let sumMu = 0
        let sumPhi2 = 0
        for (const other of teams) {
          if (other.key === me.key) continue
          wins += me.pts > other.pts ? 1 : me.pts === other.pts ? 0.5 : 0
          const p = get(other.key)
          sumMu += p.mu
          sumPhi2 += p.phi * p.phi
        }
        const others = teams.length - 1
        // The virtual opponent is the field's mean; its uncertainty shrinks with the field.
        const o: Observation = { muj: sumMu / others, phij: Math.sqrt(sumPhi2 / others / others), s: wins / others }
        const list = obs.get(me.key) ?? []
        list.push({ o, leagueId, team: me, wins, others })
        obs.set(me.key, list)
      }
    }

    const next = new Map<string, RatingState>()
    for (const [key, list] of obs) {
      const before = get(key)
      const { next: after, shares } = glicko2Update(before, list.map((x) => x.o))
      next.set(key, { ...after, lastPeriod: period })
      list.forEach((x, i) => {
        const hh = h2h.get(`${x.leagueId}|${key}`) ?? null
        events.push({
          subjectKey: key,
          leagueId: x.leagueId,
          season,
          week,
          pointsFor: x.team.pts,
          allPlayWins: x.wins,
          allPlayGames: x.others,
          opponentKey: hh?.opp ?? null,
          pointsAgainst: hh?.pa ?? null,
          result: hh == null ? null : hh.pf > hh.pa ? 'W' : hh.pf < hh.pa ? 'L' : 'T',
          ratingBefore: toDisplay(before.mu),
          ratingAfter: toDisplay(after.mu),
          rdAfter: rdOf(after.phi),
          ratingDelta: shares[i] * GLICKO.scale,
        })
      })
    }
    for (const [key, p] of R) if (!next.has(key)) next.set(key, idle(p))
    for (const [key, p] of next) R.set(key, p)

    n++
    if (opts.yieldEveryPeriods && n % opts.yieldEveryPeriods === 0) await nextTick()
  }
  return { ratings: R, events }
}

/* ──────────────────────────── Class & division ──────────────────────────── */

/** Class 1–25 from a percentile in [0, 1). */
export function classFromPercentile(pct: number): number {
  return Math.min(CLASS_COUNT, Math.max(1, Math.floor(pct * CLASS_COUNT) + 1))
}

/** Division 1–5: Classes 1–5 are division 1, 6–10 division 2, and so on. */
export function divisionOf(classLevel: number): number {
  return Math.ceil(classLevel / CLASSES_PER_DIVISION)
}

/**
 * Public ratings, with Class and division for the established ones.
 *
 * ⚠ ONLY ESTABLISHED RATINGS DEFINE THE PERCENTILES. A provisional rating carries an
 * uncertainty wide enough to land almost anywhere, so letting hundreds of them into the
 * denominator would move everyone else's Class for no reason. Provisional people get no
 * Class at all (ADR F2.10a rule 5) — never Class 1.
 */
export function classify(ratings: Map<string, RatingState>): Map<string, ClassifiedRating> {
  const est = [...ratings.values()]
    .filter((p) => rdOf(p.phi) <= GLICKO.establishedRd)
    .map((p) => toDisplay(p.mu))
    .sort((x, y) => x - y)
  const below = (r: number) => {
    let lo = 0
    let hi = est.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (est[mid] < r) lo = mid + 1
      else hi = mid
    }
    return lo
  }
  const out = new Map<string, ClassifiedRating>()
  for (const [key, p] of ratings) {
    const rating = toDisplay(p.mu)
    const rd = rdOf(p.phi)
    const established = rd <= GLICKO.establishedRd
    const percentile = established && est.length > 0 ? below(rating) / est.length : null
    const classLevel = percentile == null ? null : classFromPercentile(percentile)
    out.set(key, {
      rating,
      rd,
      volatility: p.sigma,
      games: p.games,
      lastPeriod: p.lastPeriod,
      established,
      percentile,
      classLevel,
      division: classLevel == null ? null : divisionOf(classLevel),
    })
  }
  return out
}

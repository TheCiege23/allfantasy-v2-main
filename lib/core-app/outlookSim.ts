/**
 * Season Outlook — the simulation itself, with no I/O.
 *
 * This file is PURE and CLIENT-SAFE on purpose. It used to live inside `seasonOutlook.ts`, which is
 * `server-only`, and that meant a scenario ("what if I lose my RB1 for three weeks?") needed a
 * round trip and a fresh server simulation per click. Moved here, the same model runs in the
 * browser against the same inputs, so the scenario panel and the headline numbers cannot be two
 * different models that happen to agree.
 *
 * ⚠ THE MODEL IS UNCHANGED FROM THE ONE `seasonOutlook.ts` DOCUMENTS. Each team's weekly score is a
 * normal draw from its own fitted mean and spread; the remaining schedule is the real one; seeding is
 * wins, then points for. Two things were added, and both are opt-in so the headline stays what the
 * matchup screens agree with:
 *
 *   1. `byeTeams` — a first-round bye is now played as one. The old bracket paired a six-team field
 *      1v6, 2v5, 3v4, which is not how any platform runs a six-team playoff.
 *   2. `simulateOddsBands` — the uncertainty RANGE. The headline treats each team's fitted average as
 *      known; the range re-draws it from its standard error (σ/√n) in batches and reports the spread.
 *      It is a separate run, so the headline itself does not move.
 *
 * ⚠ SEEDED, NOT Math.random(). The same inputs give the same numbers, on the server and in the
 * browser. A percentage that moves when nothing changed reads as instability in the league.
 */

export type SimProfile = { mu: number; sigma: number; n: number }

export type SimTeam = {
  rosterId: string
  wins: number
  losses: number
  pointsFor: number
  /** Null when the team has too few completed weeks to model. */
  profile: SimProfile | null
}

export type SimGame = { week: number; a: string; b: string }

export type SimInput = {
  teams: SimTeam[]
  /** Unplayed regular-season games, from the real schedule. */
  remaining: SimGame[]
  playoffTeams: number
  /** Seeds that skip the first playoff round. 0 when the field is a power of two. */
  byeTeams: number
}

/**
 * A change to one team's expected weekly score — how a scenario (an injury, a trade, a waiver add, a
 * lineup call) enters the model. Expressed in points per week so every kind of move is comparable.
 */
export type SimAdjustment = {
  rosterId: string
  /** Inclusive. Null or absent means from the first remaining week. */
  fromWeek?: number | null
  /** Inclusive. Null or absent means through the end of the season, playoffs included. */
  toWeek?: number | null
  points: number
}

/** A result fixed in advance. Points are still sampled, so points-for tiebreaks stay realistic. */
export type ForcedResult = { week: number; a: string; b: string; winner: string }

export type SimRunView = {
  /** Roster ids that made the field in this run. */
  field: ReadonlySet<string>
  finalWins: (rosterId: string) => number
}

export type SimOptions = {
  iterations: number
  seed: number
  adjustments?: readonly SimAdjustment[]
  forced?: readonly ForcedResult[]
  /** Replace this team's remaining opponents with a league-average team (the schedule driver). */
  neutralScheduleFor?: string | null
  onRun?: (run: SimRunView) => void
}

export type OddsCounts = { playoff: number; bye: number; title: number }

export type TeamFinish = {
  /** Index = final regular-season wins; value = runs that ended there. */
  winsHist: number[]
  /** Of the runs ending on that many wins, how many made the field. */
  inByWins: number[]
  /** Median final points for. */
  pointsP50: number
}

export type SimTally = {
  iterations: number
  counts: Record<string, OddsCounts>
  /** The last team into the field, per run: how many wins it had, and how many points. */
  cut: { winsHist: number[]; pointsP10: number; pointsP50: number; pointsP90: number }
  /**
   * Every team's finish distribution. Kept for all teams, not just the reader's, so one simulation
   * serves every manager in the league — the run does not depend on who is looking at it.
   */
  finishes: Record<string, TeamFinish>
}

// ── Random numbers ─────────────────────────────────────────────────────

/** mulberry32. */
export function createRng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Box–Muller, one value per call. */
function gaussian(rng: () => number, mu: number, sigma: number): number {
  const u = Math.max(rng(), 1e-12)
  const v = rng()
  return mu + sigma * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
}

/** A stable 32-bit seed from a string (the platform league id). */
export function seedFromString(value: string): number {
  let seed = 0
  for (let i = 0; i < value.length; i += 1) seed = (seed * 31 + value.charCodeAt(i)) >>> 0
  return seed || 1
}

/**
 * Standard bracket byes: the gap to the next power of two. A six-team field gives two byes, a
 * seven-team field one, a four- or eight-team field none. Used only when a league declares nothing.
 */
export function standardByes(playoffTeams: number): number {
  if (playoffTeams < 2) return 0
  let size = 1
  while (size < playoffTeams) size *= 2
  return size - playoffTeams
}

function quantile(sorted: ArrayLike<number>, q: number): number {
  const n = sorted.length
  if (n === 0) return 0
  const pos = (n - 1) * q
  const lo = Math.floor(pos)
  const hi = Math.ceil(pos)
  if (lo === hi) return sorted[lo]
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo)
}

// ── The season ─────────────────────────────────────────────────────────

type Prepared = {
  ids: string[]
  index: Map<string, number>
  mu: Float64Array
  sigma: Float64Array
  n: Float64Array
  has: Uint8Array
  baseWins: Float64Array
  basePoints: Float64Array
  ga: Int32Array
  gb: Int32Array
  adjA: Float64Array
  adjB: Float64Array
  forcedWinner: Int32Array
  playoffAdj: Float64Array
  playoffTeams: number
  byeTeams: number
  maxWins: number
}

function prepare(input: SimInput, opts: Pick<SimOptions, 'adjustments' | 'forced' | 'neutralScheduleFor'>): Prepared {
  const teams = input.teams
  const ids = teams.map((t) => t.rosterId)
  const index = new Map(ids.map((id, i) => [id, i]))
  const size = teams.length
  const mu = new Float64Array(size + 1)
  const sigma = new Float64Array(size + 1)
  const n = new Float64Array(size + 1)
  const has = new Uint8Array(size + 1)
  const baseWins = new Float64Array(size)
  const basePoints = new Float64Array(size)
  teams.forEach((t, i) => {
    baseWins[i] = t.wins
    basePoints[i] = t.pointsFor
    if (t.profile) {
      mu[i] = t.profile.mu
      sigma[i] = t.profile.sigma
      n[i] = Math.max(1, t.profile.n)
      has[i] = 1
    }
  })

  /*
   * The league-average opponent lives at index `size` — a phantom used only by the schedule driver.
   * Its mean and spread are the averages of every modelled team, so "a neutral schedule" means
   * "the typical team in THIS league", not a generic number.
   */
  const modelled = teams.filter((t) => t.profile)
  if (modelled.length > 0) {
    mu[size] = modelled.reduce((a, t) => a + t.profile!.mu, 0) / modelled.length
    sigma[size] = modelled.reduce((a, t) => a + t.profile!.sigma, 0) / modelled.length
    n[size] = 1e9
    has[size] = 1
  }

  const neutral = opts.neutralScheduleFor ? index.get(opts.neutralScheduleFor) ?? -1 : -1
  /** Marks a phantom slot in `ga`/`gb`: the league-average team, never tallied. */
  const PHANTOM = -1

  const real = input.remaining.filter((g) => index.has(g.a) && index.has(g.b))

  /*
   * 🛑 THE NEUTRAL SCHEDULE SPLITS A GAME IN TWO; IT DOES NOT JUST SWAP ONE SIDE.
   *
   * The first version replaced only the tracked team's opponent with the phantom. That also took
   * the game away from the REAL opponent — every rival silently lost one game per week of your
   * schedule, their win totals fell, and "your schedule" read as worth twenty points of playoff
   * odds in a league where your opponents averaged 0.6 points above the mean. Measured on the
   * production copy, then fixed: each of your games becomes (you vs average) and (them vs average),
   * so the only thing that changes is who YOU play.
   */
  type Slot = { week: number; a: number; b: number; ida: string | null; idb: string | null; forceable: boolean }
  const slots: Slot[] = []
  for (const g of real) {
    const a = index.get(g.a)!
    const b = index.get(g.b)!
    if (neutral >= 0 && (a === neutral || b === neutral)) {
      const other = a === neutral ? b : a
      slots.push({ week: g.week, a: neutral, b: PHANTOM, ida: ids[neutral], idb: null, forceable: false })
      slots.push({ week: g.week, a: other, b: PHANTOM, ida: ids[other], idb: null, forceable: false })
    } else {
      slots.push({ week: g.week, a, b, ida: g.a, idb: g.b, forceable: true })
    }
  }

  const count = slots.length
  const ga = new Int32Array(count)
  const gb = new Int32Array(count)
  const adjA = new Float64Array(count)
  const adjB = new Float64Array(count)
  const forcedWinner = new Int32Array(count).fill(-1)
  const lastWeek = real.reduce((m, g) => Math.max(m, g.week), 0)

  const inRange = (a: SimAdjustment, week: number) =>
    (a.fromWeek == null || week >= a.fromWeek) && (a.toWeek == null || week <= a.toWeek)

  const gamesLeft = new Float64Array(size)
  slots.forEach((g, k) => {
    ga[k] = g.a
    gb[k] = g.b
    if (g.a >= 0) gamesLeft[g.a] += 1
    if (g.b >= 0) gamesLeft[g.b] += 1
    for (const adj of opts.adjustments ?? []) {
      if (!inRange(adj, g.week)) continue
      if (adj.rosterId === g.ida) adjA[k] += adj.points
      if (adj.rosterId === g.idb) adjB[k] += adj.points
    }
    if (!g.forceable) return
    for (const f of opts.forced ?? []) {
      if (f.week !== g.week) continue
      const same = (f.a === g.ida && f.b === g.idb) || (f.a === g.idb && f.b === g.ida)
      if (!same) continue
      forcedWinner[k] = index.get(f.winner) ?? -1
    }
  })

  const playoffAdj = new Float64Array(size)
  for (const adj of opts.adjustments ?? []) {
    const i = index.get(adj.rosterId)
    if (i == null) continue
    if (adj.toWeek == null || adj.toWeek > lastWeek) playoffAdj[i] += adj.points
  }

  const playoffTeams = Math.max(1, Math.min(size, Math.floor(input.playoffTeams)))
  const byeTeams = Math.max(0, Math.min(playoffTeams - 1, Math.floor(input.byeTeams)))

  /* The most wins any team can finish on — the length of every win histogram. */
  let maxWins = 0
  for (let i = 0; i < size; i += 1) maxWins = Math.max(maxWins, baseWins[i] + gamesLeft[i])

  return {
    ids, index, mu, sigma, n, has, baseWins, basePoints, ga, gb, adjA, adjB, forcedWinner, playoffAdj,
    playoffTeams, byeTeams, maxWins,
  }
}

/**
 * One playoff bracket over a seeded field (indices in seed order). Returns the champion's index.
 *
 * With byes: seeds below the bye line play first, highest against lowest, and the survivors slot in
 * behind the bye seeds in that order — so in a six-team field the 1 seed meets the 4/5 winner and the
 * 2 seed meets the 3/6 winner. That is a FIXED bracket, which is what the platforms run; it does not
 * re-seed after an upset. Without byes: highest against lowest from the start, and an odd round gives
 * its top seed a pass — the old behaviour, unchanged.
 */
function playBracket(
  field: number[],
  byeTeams: number,
  rng: () => number,
  mu: Float64Array,
  sigma: Float64Array,
  has: Uint8Array,
  playoffAdj: Float64Array,
): number {
  const game = (x: number, y: number) => {
    if (!has[x] || !has[y]) return x
    const sx = gaussian(rng, mu[x] + playoffAdj[x], sigma[x])
    const sy = gaussian(rng, mu[y] + playoffAdj[y], sigma[y])
    return sx >= sy ? x : y
  }

  let bracket = field
  if (byeTeams > 0 && byeTeams < field.length) {
    const byes = field.slice(0, byeTeams)
    const first = field.slice(byeTeams)
    const through: number[] = []
    if (first.length % 2 === 1) through.push(first[0])
    const playing = first.length % 2 === 1 ? first.slice(1) : first
    for (let i = 0, j = playing.length - 1; i < j; i += 1, j -= 1) through.push(game(playing[i], playing[j]))
    bracket = [...byes, ...through]
  }

  while (bracket.length > 1) {
    const next: number[] = []
    if (bracket.length % 2 === 1) next.push(bracket[0])
    const contenders = bracket.length % 2 === 1 ? bracket.slice(1) : bracket
    for (let i = 0, j = contenders.length - 1; i < j; i += 1, j -= 1) next.push(game(contenders[i], contenders[j]))
    bracket = next
  }
  return bracket[0]
}

type RunSink = {
  playoff: Float64Array
  bye: Float64Array
  title: Float64Array
}

function runSeasons(
  p: Prepared,
  iterations: number,
  seed: number,
  mu: Float64Array,
  sink: RunSink,
  extra?: {
    cutWins?: number[]
    cutPoints?: number[]
    /** size × (maxWins + 1), row-major. */
    finishWins?: Float64Array
    finishIn?: Float64Array
    /** size × iterations, row-major. */
    finishPoints?: Float64Array
    onRun?: (run: SimRunView) => void
  },
): void {
  const size = p.ids.length
  const phantom = size
  const wins = new Float64Array(size)
  const points = new Float64Array(size)
  const order = new Array<number>(size)

  for (let it = 0; it < iterations; it += 1) {
    const rng = createRng(seed + it * 9973)
    wins.set(p.baseWins)
    points.set(p.basePoints)

    for (let k = 0; k < p.ga.length; k += 1) {
      const rawA = p.ga[k]
      const rawB = p.gb[k]
      const a = rawA < 0 ? phantom : rawA
      const b = rawB < 0 ? phantom : rawB
      if (!p.has[a] || !p.has[b]) continue
      const sa = gaussian(rng, mu[a] + p.adjA[k], p.sigma[a])
      const sb = gaussian(rng, mu[b] + p.adjB[k], p.sigma[b])
      if (a !== phantom) points[a] += sa
      if (b !== phantom) points[b] += sb
      const forced = p.forcedWinner[k]
      const winner = forced >= 0 ? forced : sa >= sb ? a : b
      if (winner !== phantom) wins[winner] += 1
    }

    for (let i = 0; i < size; i += 1) order[i] = i
    order.sort((x, y) => wins[y] - wins[x] || points[y] - points[x])

    const field = order.slice(0, p.playoffTeams)
    for (const i of field) sink.playoff[i] += 1
    for (let s = 0; s < p.byeTeams; s += 1) sink.bye[order[s]] += 1

    if (extra) {
      const cut = field[field.length - 1]
      if (extra.cutWins) extra.cutWins[Math.round(wins[cut])] = (extra.cutWins[Math.round(wins[cut])] ?? 0) + 1
      if (extra.cutPoints) extra.cutPoints.push(points[cut])
      if (extra.finishWins && extra.finishIn && extra.finishPoints) {
        const width = extra.finishWins.length / size
        for (let i = 0; i < size; i += 1) {
          const w = Math.min(width - 1, Math.max(0, Math.round(wins[i])))
          extra.finishWins[i * width + w] += 1
          extra.finishPoints[i * iterations + it] = points[i]
        }
        for (const i of field) {
          const w = Math.min(width - 1, Math.max(0, Math.round(wins[i])))
          extra.finishIn[i * width + w] += 1
        }
      }
      if (extra.onRun) {
        const set = new Set(field.map((i) => p.ids[i]))
        extra.onRun({
          field: set,
          finalWins: (id) => {
            const i = p.index.get(id)
            return i == null ? 0 : wins[i]
          },
        })
      }
    }

    const champ = playBracket(field, p.byeTeams, rng, mu, p.sigma, p.has, p.playoffAdj)
    if (champ != null && champ < size) sink.title[champ] += 1
  }
}

function dense(hist: number[], length: number): number[] {
  return Array.from({ length }, (_, i) => hist[i] ?? 0)
}

/**
 * Play the remaining season `iterations` times with each team's fitted average taken as known.
 * This is the headline number.
 */
export function simulateSeason(input: SimInput, opts: SimOptions): SimTally {
  const p = prepare(input, opts)
  const size = p.ids.length
  const sink: RunSink = {
    playoff: new Float64Array(size),
    bye: new Float64Array(size),
    title: new Float64Array(size),
  }
  const cutWins: number[] = []
  const cutPoints: number[] = []
  const iterations = Math.max(1, Math.floor(opts.iterations))
  const histLength = Math.max(0, Math.ceil(p.maxWins)) + 1
  const finishWins = new Float64Array(size * histLength)
  const finishIn = new Float64Array(size * histLength)
  const finishPoints = new Float64Array(size * iterations)

  runSeasons(p, iterations, opts.seed, p.mu, sink, {
    cutWins,
    cutPoints,
    finishWins,
    finishIn,
    finishPoints,
    onRun: opts.onRun,
  })

  const counts: Record<string, OddsCounts> = {}
  p.ids.forEach((id, i) => {
    counts[id] = { playoff: sink.playoff[i], bye: sink.bye[i], title: sink.title[i] }
  })

  cutPoints.sort((a, b) => a - b)

  const finishes: Record<string, TeamFinish> = {}
  p.ids.forEach((id, i) => {
    const pts = finishPoints.slice(i * iterations, (i + 1) * iterations).sort()
    finishes[id] = {
      winsHist: Array.from(finishWins.subarray(i * histLength, (i + 1) * histLength)),
      inByWins: Array.from(finishIn.subarray(i * histLength, (i + 1) * histLength)),
      pointsP50: quantile(pts, 0.5),
    }
  })

  return {
    iterations,
    counts,
    cut: {
      winsHist: dense(cutWins, histLength),
      pointsP10: quantile(cutPoints, 0.1),
      pointsP50: quantile(cutPoints, 0.5),
      pointsP90: quantile(cutPoints, 0.9),
    },
    finishes,
  }
}

export type OddsBand = { lo: number; hi: number }
export type TeamBands = { playoff: OddsBand; bye: OddsBand; title: OddsBand }

/** How many times each team's average is re-drawn for the range. */
export const PARAM_BATCHES = 10
/** Below this many seasons a batch's own sampling noise swamps the thing being measured. */
const MIN_BATCH_RUNS = 100

/**
 * The uncertainty range around each team's odds, in percentage points.
 *
 * ⚠ WHAT THE RANGE MEANS, BECAUSE A BAND WITH NO STATED MEANING IS DECORATION. A team fitted on four
 * weeks has an average we barely know; one fitted on forty has an average we know well. Each batch
 * re-draws every team's average from N(μ, σ/√n) — its standard error — and plays the season out.
 * The band is the 10th–90th percentile of the batch results, so it widens exactly where the data is
 * thin and it also carries the simulation's own sampling noise. It is NOT a confidence interval on
 * the league's future; it is how much the number would move if we had fitted the teams differently.
 */
export function simulateOddsBands(
  input: SimInput,
  opts: Pick<SimOptions, 'seed' | 'adjustments' | 'forced'> & { iterations: number; batches?: number },
): Record<string, TeamBands> {
  const p = prepare(input, opts)
  const size = p.ids.length
  const batches = Math.max(2, Math.floor(opts.batches ?? PARAM_BATCHES))
  const perBatch = Math.max(MIN_BATCH_RUNS, Math.floor(opts.iterations / batches))

  const results = {
    playoff: Array.from({ length: size }, () => new Float64Array(batches)),
    bye: Array.from({ length: size }, () => new Float64Array(batches)),
    title: Array.from({ length: size }, () => new Float64Array(batches)),
  }

  const drawn = new Float64Array(p.mu.length)
  for (let b = 0; b < batches; b += 1) {
    const paramRng = createRng((opts.seed ^ 0x9e3779b9) + b * 7919)
    drawn.set(p.mu)
    for (let i = 0; i < size; i += 1) {
      if (!p.has[i]) continue
      drawn[i] = gaussian(paramRng, p.mu[i], p.sigma[i] / Math.sqrt(p.n[i]))
    }
    const sink: RunSink = {
      playoff: new Float64Array(size),
      bye: new Float64Array(size),
      title: new Float64Array(size),
    }
    runSeasons(p, perBatch, opts.seed + 1_000_003 * (b + 1), drawn, sink)
    for (let i = 0; i < size; i += 1) {
      results.playoff[i][b] = (sink.playoff[i] / perBatch) * 100
      results.bye[i][b] = (sink.bye[i] / perBatch) * 100
      results.title[i][b] = (sink.title[i] / perBatch) * 100
    }
  }

  const band = (values: Float64Array): OddsBand => {
    const sorted = Float64Array.from(values).sort()
    return { lo: quantile(sorted, 0.1), hi: quantile(sorted, 0.9) }
  }

  const out: Record<string, TeamBands> = {}
  p.ids.forEach((id, i) => {
    out[id] = {
      playoff: band(results.playoff[i]),
      bye: band(results.bye[i]),
      title: band(results.title[i]),
    }
  })
  return out
}

/** Widen a band so it always contains the headline it sits beside. */
export function bandAround(band: OddsBand, headline: number): OddsBand {
  return { lo: Math.min(band.lo, headline), hi: Math.max(band.hi, headline) }
}

export const pctOf = (count: number, iterations: number) => (iterations > 0 ? (count / iterations) * 100 : 0)

// ── Deterministic facts (no simulation) ────────────────────────────────

/**
 * Clinched or eliminated, by arithmetic rather than by a percentage that rounds to 0 or 100.
 *
 * Eliminated: at least `playoffTeams` other teams ALREADY have more wins than you can reach. Clinched:
 * fewer than `playoffTeams` other teams can even reach your current total. Ties are resolved against
 * you in both tests, because the points tiebreak is not decided yet.
 */
export function mathStatus(input: SimInput, rosterId: string): 'clinched' | 'eliminated' | null {
  const me = input.teams.find((t) => t.rosterId === rosterId)
  if (!me) return null
  const left = (id: string) => input.remaining.filter((g) => g.a === id || g.b === id).length
  const myMax = me.wins + left(rosterId)
  const others = input.teams.filter((t) => t.rosterId !== rosterId)
  const surelyAbove = others.filter((t) => t.wins > myMax).length
  if (surelyAbove >= input.playoffTeams) return 'eliminated'
  const canReach = others.filter((t) => t.wins + left(t.rosterId) >= me.wins).length
  if (canReach < input.playoffTeams) return 'clinched'
  return null
}

export type ScheduleStrength = {
  /** Mean fitted weekly score of the opponents already played. Null with no modelled opponents. */
  pastOpponentMu: number | null
  remainingOpponentMu: number | null
  /** 1 = hardest in the league. Null when not rankable. */
  pastRank: number | null
  remainingRank: number | null
  leagueMu: number | null
  pastGames: number
  remainingGames: number
}

/**
 * Strength of schedule, past and remaining, kept apart.
 *
 * ⚠ BOTH HALVES USE EACH OPPONENT'S FITTED AVERAGE, NOT WHAT THEY SCORED AGAINST YOU. Points against is
 * luck as much as strength — a 150-point week from a middling team does not make it a hard opponent.
 * The same yardstick on both halves is what makes "you have had it easy; it gets harder" a comparison
 * rather than two different measurements side by side.
 */
export function scheduleStrength(
  input: SimInput,
  played: readonly SimGame[],
): Record<string, ScheduleStrength> {
  const muOf = new Map(input.teams.map((t) => [t.rosterId, t.profile?.mu ?? null]))
  const modelled = input.teams.filter((t) => t.profile)
  const leagueMu = modelled.length ? modelled.reduce((a, t) => a + t.profile!.mu, 0) / modelled.length : null

  const mean = (games: readonly SimGame[], id: string) => {
    const opp = games
      .filter((g) => g.a === id || g.b === id)
      .map((g) => muOf.get(g.a === id ? g.b : g.a))
      .filter((v): v is number => typeof v === 'number')
    return { value: opp.length ? opp.reduce((a, v) => a + v, 0) / opp.length : null, games: opp.length }
  }

  const rows = input.teams.map((t) => ({
    id: t.rosterId,
    past: mean(played, t.rosterId),
    rest: mean(input.remaining, t.rosterId),
  }))

  const rankBy = (pick: (r: (typeof rows)[number]) => number | null) => {
    const ranked = rows.filter((r) => pick(r) != null).sort((x, y) => pick(y)! - pick(x)!)
    return new Map(ranked.map((r, i) => [r.id, i + 1]))
  }
  const pastRank = rankBy((r) => r.past.value)
  const restRank = rankBy((r) => r.rest.value)

  const out: Record<string, ScheduleStrength> = {}
  for (const r of rows) {
    out[r.id] = {
      pastOpponentMu: r.past.value,
      remainingOpponentMu: r.rest.value,
      pastRank: pastRank.get(r.id) ?? null,
      remainingRank: restRank.get(r.id) ?? null,
      leagueMu,
      pastGames: r.past.games,
      remainingGames: r.rest.games,
    }
  }
  return out
}

export type Milestones = {
  /** Regular-season games per team, played plus remaining. */
  totalGames: number
  /** Fewest final wins that get you in at least half the time. Null when none does. */
  winsForLikely: number | null
  /** Fewest final wins that get you in nine times in ten. */
  winsForSafe: number | null
  /** The cut line: wins of the last team in, most common value and the range covering 80%. */
  cutWinsMedian: number | null
  cutWinsLow: number | null
  cutWinsHigh: number | null
  cutPointsMedian: number | null
  cutPointsLow: number | null
  cutPointsHigh: number | null
  /** Your most likely final win total. */
  projectedWins: number | null
  projectedPoints: number | null
  /** P(in | final wins = w), in percent, for each reachable w (index = w). Null where no run ended there. */
  oddsByWins: Array<number | null>
  currentWins: number
  maxWins: number
}

const MIN_RUNS_FOR_A_RECORD = 40

export function readMilestones(
  tally: Pick<SimTally, 'iterations' | 'cut' | 'finishes'>,
  input: SimInput,
  rosterId: string,
): Milestones | null {
  const me = input.teams.find((t) => t.rosterId === rosterId)
  const tracked = tally.finishes[rosterId]
  if (!me || !tracked || !me.profile) return null
  const left = input.remaining.filter((g) => g.a === rosterId || g.b === rosterId).length
  const maxWins = me.wins + left

  const oddsByWins: Array<number | null> = []
  for (let w = 0; w <= maxWins; w += 1) {
    const runs = tracked.winsHist[w] ?? 0
    oddsByWins[w] = w < me.wins || runs < MIN_RUNS_FOR_A_RECORD ? null : ((tracked.inByWins[w] ?? 0) / runs) * 100
  }

  const firstAt = (threshold: number) => {
    for (let w = me.wins; w <= maxWins; w += 1) {
      const v = oddsByWins[w]
      if (v != null && v >= threshold) return w
    }
    return null
  }

  const histQuantile = (hist: number[], q: number) => {
    const total = hist.reduce((a, v) => a + v, 0)
    if (total === 0) return null
    let seen = 0
    for (let w = 0; w < hist.length; w += 1) {
      seen += hist[w]
      if (seen >= total * q) return w
    }
    return hist.length - 1
  }

  return {
    totalGames: me.wins + me.losses + left,
    winsForLikely: firstAt(50),
    winsForSafe: firstAt(90),
    cutWinsMedian: histQuantile(tally.cut.winsHist, 0.5),
    cutWinsLow: histQuantile(tally.cut.winsHist, 0.1),
    cutWinsHigh: histQuantile(tally.cut.winsHist, 0.9),
    cutPointsMedian: tally.iterations > 0 ? tally.cut.pointsP50 : null,
    cutPointsLow: tally.iterations > 0 ? tally.cut.pointsP10 : null,
    cutPointsHigh: tally.iterations > 0 ? tally.cut.pointsP90 : null,
    projectedWins: histQuantile(tracked.winsHist, 0.5),
    projectedPoints: tally.iterations > 0 ? tracked.pointsP50 : null,
    oddsByWins,
    currentWins: me.wins,
    maxWins,
  }
}

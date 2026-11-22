/**
 * AF PROJECTION FACTORS — LEARNED FROM WHAT ACTUALLY HAPPENED (owner's call, 2026-11-22: "combine those projections with
 * the player's current streak of points, touches … how they did against specific defenses … how they do after off days
 * or back to back days in the NBA … so it's closer to the real number").
 *
 * Every factor here is MEASURED, never assumed. For each past game we know three things: what the player had been
 * scoring going in (his trailing average — the baseline a projection starts from), what he actually scored, and the
 * situation (back-to-back, hot streak, rising minutes, soft opponent, new team, back from a layoff). The ratio
 * actual ÷ baseline, grouped by situation, against the same ratio in the ordinary situation, IS the factor:
 *
 *   factor(level) = weighted median(actual/baseline | level) ÷ weighted median(actual/baseline | baseline level)
 *
 * Then the part that makes it a number worth showing: a HOLD-OUT CHECK. Fit on the older 75% of games, apply to the
 * newer 25%, and publish a level only if it made those later games' projections closer to what was scored (lower mean
 * absolute error than the trailing average alone, on enough games). A factor that was noise is measured, shown on the
 * admin page, and never moves a projection.
 *
 * PURE: no database, no clock beyond what is passed.
 */

export type FactorName = 'rest' | 'form' | 'usage' | 'opponent' | 'team_change' | 'returning'

/** Each factor's levels; the first is its baseline (ordinary) level, which is never applied. */
export const FACTOR_LEVELS: Readonly<Record<FactorName, readonly string[]>> = {
  rest: ['normal', 'back_to_back', 'short_rest', 'long_rest'],
  form: ['steady', 'hot', 'cold'],
  usage: ['steady', 'rising', 'falling'],
  opponent: ['average', 'soft', 'tough'],
  team_change: ['same_team', 'new_team'],
  returning: ['playing', 'returning'],
}

export type FactorLevels = Partial<Record<FactorName, string>>

export type FactorObservation = {
  /** The trailing average going into the game (fantasy points, the feed's own scoring). */
  baseline: number
  actual: number
  levels: FactorLevels
  /** Game time, for the hold-out split and recency weighting. */
  atMs: number
}

export type LearnedFactorLevel = {
  factor: FactorName
  level: string
  /** actual/baseline in this situation over the same in the ordinary one; 1 = no effect. Held to ±MAX_FACTOR_EFFECT. */
  multiplier: number
  /** Games in this situation the multiplier rests on (all of them, before the split). */
  games: number
  /** Mean absolute error on the later games in this situation: trailing average alone, then with this factor. */
  holdout: { games: number; plainMae: number | null; factorMae: number | null }
  published: boolean
  note: string
}

export type LearnedFactorTable = {
  sport: string
  generatedAt: string
  observations: number
  /** The whole model on the later games: trailing average alone vs with every published factor. */
  overall: { games: number; plainMae: number | null; factorMae: number | null; improvementPct: number | null }
  levels: LearnedFactorLevel[]
}

export const MIN_LEVEL_GAMES = 150
export const MIN_HOLDOUT_GAMES = 40
export const MAX_FACTOR_EFFECT = 0.2
/** Recent games count more: a game's weight halves every year. */
const HALF_LIFE_MS = 365 * 86_400_000

const r3 = (n: number) => Math.round(n * 1000) / 1000

function weightedMedian(values: Array<{ v: number; w: number }>): number | null {
  const xs = values.filter((x) => Number.isFinite(x.v) && x.w > 0).sort((a, b) => a.v - b.v)
  if (!xs.length) return null
  const total = xs.reduce((s, x) => s + x.w, 0)
  let acc = 0
  for (const x of xs) {
    acc += x.w
    if (acc >= total / 2) return x.v
  }
  return xs[xs.length - 1]!.v
}

const usable = (o: FactorObservation) => Number.isFinite(o.baseline) && o.baseline > 0.5 && Number.isFinite(o.actual) && o.actual >= 0

function fitMultiplier(obs: readonly FactorObservation[], factor: FactorName, level: string, nowMs: number): number | null {
  const base = FACTOR_LEVELS[factor][0]
  const w = (o: FactorObservation) => Math.pow(0.5, Math.max(0, nowMs - o.atMs) / HALF_LIFE_MS)
  const inLevel = obs.filter((o) => o.levels[factor] === level)
  const inBase = obs.filter((o) => (o.levels[factor] ?? base) === base)
  const m = weightedMedian(inLevel.map((o) => ({ v: o.actual / o.baseline, w: w(o) })))
  const b = weightedMedian(inBase.map((o) => ({ v: o.actual / o.baseline, w: w(o) })))
  if (m == null || b == null || !(b > 0)) return null
  const raw = m / b
  return Math.max(1 - MAX_FACTOR_EFFECT, Math.min(1 + MAX_FACTOR_EFFECT, raw))
}

const mae = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + Math.abs(x), 0) / xs.length : null)

/** Multiply a baseline by every published factor its situation has. PURE. */
export function applyLearnedFactors(
  baseline: number,
  levels: FactorLevels,
  table: Pick<LearnedFactorTable, 'levels'> | null | undefined,
  options: { cap?: number } = {},
): { value: number; multiplier: number; applied: LearnedFactorLevel[] } {
  if (!table) return { value: baseline, multiplier: 1, applied: [] }
  let m = 1
  const applied: LearnedFactorLevel[] = []
  for (const row of table.levels) {
    if (!row.published || levels[row.factor] !== row.level) continue
    m *= row.multiplier
    applied.push(row)
  }
  // Together the factors may move a projection by at most ±cap (default 25%) — a stack of small effects is not a reason
  // to double or halve a player.
  const cap = options.cap ?? 0.25
  m = Math.max(1 - cap, Math.min(1 + cap, m))
  return { value: baseline * m, multiplier: r3(m), applied }
}

/** Fit, check on later games, publish. PURE. */
export function learnFactors(sport: string, observations: readonly FactorObservation[], now: Date, holdoutShare = 0.25): LearnedFactorTable {
  const obs = observations.filter(usable).slice().sort((a, b) => a.atMs - b.atMs)
  const split = Math.floor(obs.length * (1 - holdoutShare))
  const train = obs.slice(0, split)
  const test = obs.slice(split)
  const nowMs = now.getTime()
  const trainEnd = train.length ? train[train.length - 1]!.atMs : nowMs

  const levels: LearnedFactorLevel[] = []
  for (const factor of Object.keys(FACTOR_LEVELS) as FactorName[]) {
    for (const level of FACTOR_LEVELS[factor].slice(1)) {
      const games = obs.filter((o) => o.levels[factor] === level).length
      const fitted = train.filter((o) => o.levels[factor] === level).length >= MIN_LEVEL_GAMES * 0.75 ? fitMultiplier(train, factor, level, trainEnd) : null
      const later = test.filter((o) => o.levels[factor] === level)
      const plainMae = mae(later.map((o) => o.actual - o.baseline))
      const factorMae = fitted == null ? null : mae(later.map((o) => o.actual - o.baseline * fitted))
      const enough = games >= MIN_LEVEL_GAMES && later.length >= MIN_HOLDOUT_GAMES
      const helped = fitted != null && plainMae != null && factorMae != null && factorMae < plainMae
      // The number shown and applied is refit on every game, once it has earned its place on the later ones.
      const multiplier = enough && helped ? fitMultiplier(obs, factor, level, nowMs) ?? fitted! : fitted ?? 1
      levels.push({
        factor,
        level,
        multiplier: r3(multiplier),
        games,
        holdout: { games: later.length, plainMae: plainMae == null ? null : r3(plainMae), factorMae: factorMae == null ? null : r3(factorMae) },
        published: enough && helped && Math.abs(multiplier - 1) >= 0.01,
        note: !enough
          ? `not enough games yet (${games} of ${MIN_LEVEL_GAMES}, ${later.length} of ${MIN_HOLDOUT_GAMES} later)`
          : !helped
            ? 'did not make later games’ projections closer — measured, not used'
            : Math.abs(multiplier - 1) < 0.01
              ? 'no real effect'
              : `measured on ${games} games; closer on ${later.length} later ones`,
      })
    }
  }

  // The whole published model on the later games — the honest summary of whether AF's number beats the plain one.
  const table = { levels: levels.map((l) => ({ ...l })) }
  const plain = mae(test.map((o) => o.actual - o.baseline))
  const withFactors = mae(test.map((o) => o.actual - applyLearnedFactors(o.baseline, o.levels, table).value))
  return {
    sport,
    generatedAt: now.toISOString(),
    observations: obs.length,
    overall: {
      games: test.length,
      plainMae: plain == null ? null : r3(plain),
      factorMae: withFactors == null ? null : r3(withFactors),
      improvementPct: plain && withFactors != null ? Math.round(((plain - withFactors) / plain) * 1000) / 10 : null,
    },
    levels,
  }
}

/** One plain line per sport for the cron's log. PURE. */
export function describeFactorTable(t: LearnedFactorTable): string {
  const pub = t.levels.filter((l) => l.published)
  const imp = t.overall.improvementPct
  return `${t.sport} projection factors: ${t.observations} games read, ${pub.length} of ${t.levels.length} published` +
    (pub.length ? ` (${pub.map((l) => `${l.factor} ${l.level} ×${l.multiplier}`).join(', ')})` : '') +
    (imp == null ? '' : `; on later games the published factors were ${imp > 0 ? `${imp}% closer to` : `${-imp}% further from`} what was scored`)
}

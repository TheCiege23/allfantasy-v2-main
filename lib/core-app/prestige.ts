/**
 * GM prestige — the one implementation.
 *
 * ⚠ EXTRACTED FROM `lib/core-app/career.ts`, WHICH NOW IMPORTS IT. Handoff 14b
 * makes the FAQ the single source of truth for every scoring constant in the
 * product, and 14a's leaderboard ranks managers by this exact score. Two copies
 * of these weights would drift the moment one surface was tuned, and the drift
 * would be invisible: both screens would render a confident number and only a
 * user comparing them side by side would ever notice.
 *
 * ⚠ PURE ON PURPOSE — NO PRISMA, NO `server-only`. The five inputs all live on
 * `UserProfile` as denormalised counters, so a cross-user leaderboard can score
 * N managers from one query instead of running the career aggregator N times.
 * Keeping this module free of `server-only` also keeps it testable: the repo's
 * Vitest setup stubs that import, so anything reaching for it is only ever
 * proven by a separate `tsx` run.
 */

/** One capped component of the GM prestige score. */
export type PrestigeComponent = {
  key: 'championships' | 'winRate' | 'tenure' | 'leagues' | 'playoffs'
  label: string
  /** Raw achieved value (3 championships, 9 seasons…). */
  value: number
  /** The cap. Beyond this the component stops contributing — one huge number
   *  must not be able to carry the whole score. */
  max: number
  /** value/max clamped to 0..1. */
  ratio: number
  /** Share of the total prestige score this component is worth. */
  weight: number
  /** How this component is written on screen: "3/10", "58%". */
  display: string
  /**
   * True when the raw value is at or past the cap. Measured on a real account:
   * 521 leagues against a cap of 15 rendered as "521/15", which reads as a
   * broken widget rather than a maxed one. The UI shows saturated components as
   * MAXED — the cap is working as the handoff intends, and saying so is honest.
   */
  saturated: boolean
}

/**
 * The handoff's own help text: championships 30%, win rate 20%, tenure 20%,
 * league diversity 15%, playoff appearances 15%, each capped. Caps are the
 * handoff's too (3/10, 9/20, 11/15, 14/30).
 */
export const PRESTIGE_SPEC = [
  { key: 'championships', label: 'Championships', max: 10, weight: 0.3 },
  { key: 'winRate', label: 'Win rate', max: 1, weight: 0.2 },
  { key: 'tenure', label: 'Tenure', max: 20, weight: 0.2 },
  { key: 'leagues', label: 'Leagues', max: 15, weight: 0.15 },
  { key: 'playoffs', label: 'Playoffs', max: 30, weight: 0.15 },
] as const

export type PrestigeInput = {
  championships: number
  /** Games-weighted, 0..1. `null` when nothing has been played — NOT zero. */
  winRate: number | null
  seasonsPlayed: number
  leaguesPlayed: number
  playoffAppearances: number
}

export type Prestige = { total: number; components: PrestigeComponent[] }

function pct(n: number): number {
  return Math.round(n * 1000) / 10
}

/**
 * Score a manager 0–100.
 *
 * ⚠ A NULL WIN RATE CONTRIBUTES ZERO BUT DISPLAYS AS "—". Someone with no games
 * played has an unknown win rate, not a bad one, and the display has to say so.
 * The contribution is still zero because there is no defensible alternative —
 * re-normalising the remaining weights would let a manager with one lucky title
 * and no record outrank someone with a decade of results.
 */
export function computePrestige(input: PrestigeInput): Prestige {
  const raw: Record<PrestigeComponent['key'], { value: number; display: string }> = {
    championships: { value: input.championships, display: `${input.championships}/10` },
    winRate: {
      value: input.winRate ?? 0,
      display: input.winRate != null ? `${pct(input.winRate)}%` : '—',
    },
    tenure: { value: input.seasonsPlayed, display: `${input.seasonsPlayed}/20` },
    leagues: { value: input.leaguesPlayed, display: `${input.leaguesPlayed}/15` },
    playoffs: { value: input.playoffAppearances, display: `${input.playoffAppearances}/30` },
  }

  const components: PrestigeComponent[] = PRESTIGE_SPEC.map((spec) => {
    const r = raw[spec.key]
    const ratio = Math.max(0, Math.min(r.value / spec.max, 1))
    return {
      key: spec.key,
      label: spec.label,
      value: r.value,
      max: spec.max,
      ratio,
      weight: spec.weight,
      display: r.display,
      saturated: r.value >= spec.max,
    }
  })

  const total = Math.round(components.reduce((s, c) => s + c.ratio * c.weight, 0) * 1000) / 10
  return { total, components }
}

/** Games-weighted win rate, or null when nothing was played. */
export function winRateOf(wins: number, losses: number, ties = 0): number | null {
  const games = wins + losses + ties
  if (games <= 0) return null
  return (wins + ties * 0.5) / games
}

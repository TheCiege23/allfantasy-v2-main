/**
 * The commissioner's tiebreaker order (docs/AF_COMMISSIONER_SETTINGS_SPEC.md: custom tiebreakers).
 * Record always comes first; this is the order that separates teams level on record — for the
 * playoff seeds (lib/playoff-runtime/canonicalNflRedraftPlayoffRuntime.ts) and the standings board
 * (lib/core-app/standingsModel.ts), which both read it from `League.settings.tiebreaker_order`.
 *
 *   head_to_head    better record against the teams it is tied with
 *   points_for      more points scored
 *   points_against  fewer points scored against
 *   all_play        better record had it played every team every week
 *   coin_flip       a draw, settled once per season
 *
 * ⚠ THE COIN FLIP IS A SEEDED DRAW, NOT `Math.random()`. A random flip on every read would reorder
 * two tied teams each time the standings load, and the seeds the bracket was built from could not
 * be reproduced afterwards. Each team's draw is a hash of the season and its roster id: fixed for
 * the season, different next season, and the same answer on every screen.
 *
 * ⚠ HEAD-TO-HEAD IN A THREE-WAY TIE. The seeds apply it to the whole tied group (a team that beat
 * every other member ranks first — the NFL "sweep" rule); the standings board compares two rows at a
 * time. For two tied teams, which is nearly every tie, they agree. In a three-way tie with no sweeper
 * the board can show a different order from the seeds; the seeds are the ones the bracket uses.
 *
 * Pure.
 */

export const TIEBREAKER_ORDER_KEY = 'tiebreaker_order'

export const TIEBREAKER_KEYS = ['head_to_head', 'points_for', 'points_against', 'all_play', 'coin_flip'] as const
export type TiebreakerKey = (typeof TIEBREAKER_KEYS)[number]

const KNOWN: ReadonlySet<string> = new Set(TIEBREAKER_KEYS)

export const TIEBREAKER_LABELS: Record<TiebreakerKey, { en: string; es: string }> = {
  head_to_head: { en: 'Head-to-head', es: 'Enfrentamiento directo' },
  points_for: { en: 'Points for', es: 'Puntos a favor' },
  points_against: { en: 'Fewest points against', es: 'Menos puntos en contra' },
  all_play: { en: 'All-play record', es: 'Récord contra todos' },
  coin_flip: { en: 'Coin flip', es: 'Moneda al aire' },
}

/** The order a league starts from: points for first, as the standings board and the seeds both default. */
export const DEFAULT_TIEBREAKER_ORDER: readonly TiebreakerKey[] = ['points_for', 'head_to_head', 'points_against', 'all_play', 'coin_flip']

/** The commissioner's order, or null when the league has not chosen one (or the value is unreadable). */
export function readTiebreakerOrder(settings: unknown): TiebreakerKey[] | null {
  const s = settings && typeof settings === 'object' && !Array.isArray(settings) ? (settings as Record<string, unknown>) : {}
  const parsed = parseTiebreakerOrder(s[TIEBREAKER_ORDER_KEY])
  return parsed.ok ? parsed.value : null
}

export type TiebreakerOrderInput = { ok: true; value: TiebreakerKey[] | null } | { ok: false; error: string }

/**
 * Validate a save: a list of known keys, each at most once, or null / [] to go back to the default.
 * Unknown keys are refused rather than dropped, so a typo cannot quietly change how a league seeds.
 */
export function parseTiebreakerOrder(value: unknown): TiebreakerOrderInput {
  if (value == null) return { ok: true, value: null }
  if (!Array.isArray(value)) return { ok: false, error: 'The tiebreaker order must be a list.' }
  if (value.length === 0) return { ok: true, value: null }
  const out: TiebreakerKey[] = []
  for (const raw of value) {
    const key = typeof raw === 'string' ? raw.trim().toLowerCase() : ''
    if (!KNOWN.has(key)) return { ok: false, error: `Unknown tiebreaker: ${String(raw)}.` }
    if (out.includes(key as TiebreakerKey)) return { ok: false, error: `A tiebreaker is listed twice: ${key}.` }
    out.push(key as TiebreakerKey)
  }
  return { ok: true, value: out }
}

/** Move one key up (-1) or down (+1); out-of-range moves leave the order as it is. */
export function moveTiebreaker(order: readonly TiebreakerKey[], key: TiebreakerKey, by: -1 | 1): TiebreakerKey[] {
  const out = [...order]
  const i = out.indexOf(key)
  const j = i + by
  if (i < 0 || j < 0 || j >= out.length) return out
  ;[out[i], out[j]] = [out[j]!, out[i]!]
  return out
}

/**
 * A team's coin-flip draw for a season, in [0, 1). Higher wins. FNV-1a over `${seed}:${rosterId}` —
 * stable across processes and screens, which `Math.random()` is not.
 */
export function coinFlipDraw(seed: string, rosterId: string): number {
  let h = 0x811c9dc5
  const text = `${seed}:${rosterId}`
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h / 0x100000000
}

/**
 * All-play win share per team: each week, every team is measured against every other team's score
 * that week (wins + half ties) / opponents, summed over the weeks it played and divided by them.
 * `weeks` is week → rosterId → points.
 */
export function allPlayShares(weeks: ReadonlyMap<number, ReadonlyMap<string, number>>): Map<string, number> {
  const sum = new Map<string, { share: number; weeks: number }>()
  for (const scores of weeks.values()) {
    const entries = [...scores.entries()]
    if (entries.length < 2) continue
    for (const [rosterId, pts] of entries) {
      let wins = 0
      for (const [other, otherPts] of entries) {
        if (other === rosterId) continue
        wins += pts > otherPts ? 1 : pts === otherPts ? 0.5 : 0
      }
      const row = sum.get(rosterId) ?? { share: 0, weeks: 0 }
      row.share += wins / (entries.length - 1)
      row.weeks += 1
      sum.set(rosterId, row)
    }
  }
  return new Map([...sum].map(([id, row]) => [id, row.weeks ? Math.round((row.share / row.weeks) * 1000) / 1000 : 0]))
}

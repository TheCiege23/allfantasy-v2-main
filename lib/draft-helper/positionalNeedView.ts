/**
 * Turn the recommendation engine's need scores into the bars Draft HQ renders.
 *
 * ⚠ THE TWO SCALES ARE INVERTED, AND READING ONE AS THE OTHER PAINTS A SOLVED POSITION
 * AS A CRISIS.
 *
 * `computeNeeds` in RecommendationEngine returns HIGH = NEED:
 *
 *     count < starter  ->  88 + (starter - count) * 10     // a hole
 *     count < ideal    ->  42 + (ideal - count) * 12       // thin
 *     otherwise        ->  10                              // stocked
 *
 * Draft HQ's card is the opposite — "a low score means the position is a hole, a high
 * score means it is solved". So a stocked TE arrives as 10 and must render as 90. This
 * module owns that flip so no caller has to remember which way round it is.
 *
 * ⚠ AN ABSENT POSITION IS NOT A SOLVED ONE. The engine only returns a key for positions
 * it evaluated. A missing key means "not assessed", which is not the same as "no need" —
 * rendering it as 100 would put a green bar on a position we never looked at. Those come
 * back as `null` and the card shows them as unknown.
 */

/** Colour bands. Derived from the design: RB 41 reads bad, WR 63 warn, TE 88 good. */
export const SOLVED_GOOD_MIN = 80
export const SOLVED_WARN_MIN = 50

export type NeedBand = 'good' | 'warn' | 'bad' | 'unknown'

export type PositionalNeedRow = {
  position: string
  /** 0–100 where HIGH = solved. Null when the engine did not assess this position. */
  solved: number | null
  band: NeedBand
  /** The token the bar paints with, so the card never re-derives it. */
  token: '--good' | '--warn' | '--bad' | '--ink-3'
  /** What to render in the number column. Never a fabricated score. */
  label: string
}

export type PositionalNeedView = {
  rows: PositionalNeedRow[]
  /** Copy for the card when the engine flagged the whole board as thin. */
  caveat: string | null
  /** True when nothing at all could be assessed — the card should say so, not draw bars. */
  empty: boolean
}

function bandFor(solved: number | null): { band: NeedBand; token: PositionalNeedRow['token'] } {
  if (solved === null) return { band: 'unknown', token: '--ink-3' }
  if (solved >= SOLVED_GOOD_MIN) return { band: 'good', token: '--good' }
  if (solved >= SOLVED_WARN_MIN) return { band: 'warn', token: '--warn' }
  return { band: 'bad', token: '--bad' }
}

export function buildPositionalNeedView(args: {
  /** `needs` straight off `computeDraftPlayerRankings`. HIGH = need. */
  needs: Record<string, number> | null | undefined
  /** Which positions this league actually starts — the card should not invent slots. */
  positions: string[]
  /** `caveats` from the same call, so board-level thinness is stated rather than implied. */
  caveats?: string[]
}): PositionalNeedView {
  const { needs, positions, caveats = [] } = args

  const rows: PositionalNeedRow[] = positions.map((position) => {
    const raw = needs?.[position]
    const assessed = typeof raw === 'number' && Number.isFinite(raw)
    // The flip. Clamped because the engine's own clamp is [0,100] and a future change
    // there should not push a bar off the end of the track.
    const solved = assessed ? Math.max(0, Math.min(100, Math.round(100 - raw))) : null
    const { band, token } = bandFor(solved)
    return {
      position,
      solved,
      band,
      token,
      label: solved === null ? '—' : String(solved),
    }
  })

  return {
    rows,
    caveat: caveats.length > 0 ? caveats[0] : null,
    empty: rows.every((r) => r.solved === null),
  }
}

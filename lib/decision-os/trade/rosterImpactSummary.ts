/**
 * The wire and display form of `RosterImpact` — what a trade surface actually renders.
 *
 * ── WHY A SECOND SHAPE ────────────────────────────────────────────────────────────────────────
 *
 * `RosterImpact` carries a depth row and a replacement row for EVERY position on the roster, so a
 * panel listing five open offers would ship ~100 rows of which a manager reads two or three. This
 * keeps the headline number, the reason it could not be produced, and only the positions the trade
 * actually changes.
 *
 * ⚠ NO `server-only`, AND NO IMPORTS BEYOND TYPES. The client component that renders the line
 * imports `lineupImpactLine` from here, so this module must stay free of anything that pulls
 * Prisma into a browser bundle. `rosterImpact.ts` is imported for its TYPE only.
 */
import type { RosterImpact } from './rosterImpact'

export type LineupImpactSummary = {
  /**
   * ⚠ CARRIED ON THE WIRE, NOT ASSUMED BY THE RENDERER. `AFProjectionSnapshot` has a per-game and
   * a rest-of-season number, and confusing them understates a player by roughly the weeks left.
   */
  unit: 'projected_points_per_game'
  startingPointsBefore: number | null
  startingPointsAfter: number | null
  startingPointsDelta: number | null
  /** Non-null when no honest delta exists. Rendered verbatim — it is written for a manager. */
  blockedReason: string | null
  /** Rostered players left out of the lineup maths because nothing projects them. */
  unpricedExcluded: number
  /** Only positions whose rostered count the trade changes. Empty means "no bodies move". */
  depthChanges: Array<{ position: string; rosteredBefore: number; rosteredAfter: number }>
}

/**
 * `undefined` in, `undefined` out — and `null` in, `null` out. The evaluator uses the two to mean
 * "not asked for" and "asked for, could not be produced", and a summary that collapsed them would
 * make the renderer unable to tell a surface that never requested impact from one that failed.
 */
export function summarizeRosterImpact(
  impact: (RosterImpact & { unit: 'projected_points_per_game' }) | null | undefined,
): LineupImpactSummary | null | undefined {
  if (impact === undefined) return undefined
  if (impact === null) return null
  return {
    unit: impact.unit,
    startingPointsBefore: impact.startingPointsBefore,
    startingPointsAfter: impact.startingPointsAfter,
    startingPointsDelta: impact.startingPointsDelta,
    blockedReason: impact.blockedReason,
    unpricedExcluded: impact.unpricedExcluded,
    depthChanges: impact.depth
      .filter((row) => row.rosteredDelta !== 0)
      .map((row) => ({
        position: row.position,
        rosteredBefore: row.rosteredBefore,
        rosteredAfter: row.rosteredAfter,
      })),
  }
}

/**
 * Below this, a delta is rounding noise and is said as "no change" rather than as "+0.0".
 *
 * ⚠ A SIGNED ZERO READS AS A VERDICT. "+0.0 pts" looks like the model found a tiny gain; "no
 * change to your starting lineup" is what actually happened when the trade swaps bench pieces.
 */
const NEGLIGIBLE_DELTA = 0.05

/** For styling: which way the lineup moves, or `unknown` when no honest delta exists. */
export function lineupImpactDirection(
  summary: LineupImpactSummary | null | undefined,
): 'up' | 'down' | 'flat' | 'unknown' {
  const delta = summary?.startingPointsDelta
  if (!summary || summary.blockedReason || delta == null) return 'unknown'
  if (Math.abs(delta) < NEGLIGIBLE_DELTA) return 'flat'
  return delta > 0 ? 'up' : 'down'
}

function formatPoints(n: number): string {
  return Math.abs(n) >= 100 ? n.toFixed(0) : n.toFixed(1)
}

/**
 * One sentence about the lineup, for a trade row.
 *
 * Returns `null` only when there is nothing to say (impact was never requested). A requested but
 * unavailable impact still produces a sentence, because "we could not work out the lineup effect"
 * is information a manager weighing the offer should have — silence would read as "no effect".
 */
export function lineupImpactLine(summary: LineupImpactSummary | null | undefined): string | null {
  if (summary === undefined) return null
  if (summary === null) return 'Lineup effect unavailable for this league right now.'
  if (summary.blockedReason || summary.startingPointsDelta == null) {
    return `Lineup effect not computed: ${summary.blockedReason ?? 'no projection for this league'}.`
  }

  const delta = summary.startingPointsDelta
  const head =
    lineupImpactDirection(summary) === 'flat'
      ? 'No change to your projected starting lineup'
      : `Your projected starting lineup ${delta > 0 ? 'gains' : 'loses'} ${formatPoints(Math.abs(delta))} pts per game`

  const depth = summary.depthChanges
    .map((row) => {
      const d = row.rosteredAfter - row.rosteredBefore
      return `${row.position} ${d > 0 ? '+' : '−'}${Math.abs(d)}`
    })
    .join(', ')

  /*
   * ⚠ DISCLOSED, NOT HIDDEN. An unprojected bench player is left out of the candidate pool; if he
   * would have started, the headline is off. Saying how many lets the manager judge that.
   */
  const unpriced =
    summary.unpricedExcluded > 0
      ? ` ${summary.unpricedExcluded} unprojected ${summary.unpricedExcluded === 1 ? 'player' : 'players'} not counted.`
      : ''

  return `${head}${depth ? ` · roster ${depth}` : ''}.${unpriced}`
}

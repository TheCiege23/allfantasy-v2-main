/**
 * The Lineup Integrity score — pure. No IO, no clock, so every number a commissioner is shown can be
 * reproduced in a test.
 *
 *     score = projected points the manager STARTED ÷ the best lineup they could have started
 *
 * Both sides use the projections they could see when each player's game kicked off
 * (lib/integrity/lineupLockSnapshots.ts), never the numbers known after the week. A player who could
 * not play (Out, IR, Doubtful, Suspended, bye) is removed from the options: nobody is marked down for
 * not starting someone who was never going to score, and a starter who could not play counts zero.
 *
 * ⚠ ONE BAD WEEK IS NOT TANKING. A manager who forgot to check their lineup on a Sunday looks exactly
 * like one who meant it, once. The flag needs a PATTERN (`lineupIntegrityPattern`): several scored
 * weeks in a row below a line that rises with the league's sensitivity. A week that could not be
 * scored — too few projections, no saved lineup — neither counts toward a run nor breaks one.
 *
 * ⚠ AND NOT OWNING YOUR OWN FIRST-ROUND PICK REMOVES THE MOTIVE. Losing on purpose buys a better draft
 * slot; a team whose next first belongs to someone else gets nothing for it. That lowers the risk one
 * level and the card says why (`pickOwnershipNote`), so a commissioner can see the reasoning rather
 * than an unexplained softer label.
 */

import { computeOptimalLineup, type LineupSlotSpec } from '@/lib/lineup-optimizer/optimalLineup'
import { unplayableReason, type TankingSeverity } from './tankingRules'
import type { IntegritySensitivity } from './sensitivity'

export const LINEUP_INTEGRITY_ALGORITHM = 'lineup-integrity-v1'

/** One player as the manager saw them at kickoff. */
export type SnapshotPlayer = {
  name?: string | null
  position?: string | null
  proj?: number | null
  status?: string | null
  bye?: number | null
  team?: string | null
  /** When the player's game started and this entry stopped changing. Null while it can still move. */
  frozenAt?: string | null
}

/** One starting seat: its label and the positions that may fill it. */
export type SnapshotSlot = { slot: string; eligible: string[] }

export type WeekScoreInput = {
  week: number
  players: Record<string, SnapshotPlayer>
  slots: readonly SnapshotSlot[]
  /** The players the week's saved lineup STARTED. */
  starterIds: readonly string[]
}

export type WeekScore =
  | {
      scored: true
      startedProj: number
      optimalProj: number
      /** started ÷ optimal, 0..1 (capped at 1). */
      ratio: number
      /** How many of their starters were in the best lineup. */
      startedTopCount: number
      /** Seats in the lineup. */
      starterCount: number
      /** Players removed from the options because they could not play. */
      excludedIds: string[]
    }
  | { scored: false; skipReason: 'no_lineup' | 'no_slots' | 'thin_projections' | 'no_projected_points' }

/** Above this share of the roster without a projection, the week is not scored. */
export const MAX_MISSING_PROJECTION_SHARE = 0.25

function round1(n: number): number {
  return Math.round(n * 10) / 10
}

export function scoreLineupWeek(input: WeekScoreInput): WeekScore {
  const ids = Object.keys(input.players)
  if (input.starterIds.length === 0 || ids.length === 0) return { scored: false, skipReason: 'no_lineup' }
  if (input.slots.length === 0) return { scored: false, skipReason: 'no_slots' }

  const excluded = new Set<string>()
  for (const id of ids) {
    const p = input.players[id]
    if (unplayableReason({ playerId: id, status: p.status ?? undefined, byeWeek: p.bye ?? null }, input.week)) excluded.add(id)
  }
  const available = ids.filter((id) => !excluded.has(id))
  const missing = available.filter((id) => typeof input.players[id].proj !== 'number').length
  if (available.length === 0 || missing / available.length > MAX_MISSING_PROJECTION_SHARE) {
    return { scored: false, skipReason: 'thin_projections' }
  }

  const proj = (id: string) => {
    const v = input.players[id]?.proj
    return typeof v === 'number' && Number.isFinite(v) ? v : 0
  }
  const specs: LineupSlotSpec[] = input.slots.map((s, i) => ({ slot: s.slot, eligible: s.eligible, count: 1, slotOrder: i }))
  const optimal = computeOptimalLineup({
    players: available.map((id) => ({ playerId: id, positions: positionsOf(input.players[id].position), points: proj(id) })),
    slots: specs,
  })
  if (!(optimal.total > 0)) return { scored: false, skipReason: 'no_projected_points' }

  const starters = [...new Set(input.starterIds)]
  const startedProj = starters.reduce((sum, id) => sum + (excluded.has(id) ? 0 : proj(id)), 0)
  const best = new Set(optimal.assignments.map((a) => a.playerId))
  return {
    scored: true,
    startedProj: round1(startedProj),
    optimalProj: round1(optimal.total),
    ratio: Math.min(1, Math.max(0, startedProj / optimal.total)),
    startedTopCount: starters.filter((id) => best.has(id)).length,
    starterCount: input.slots.length,
    excludedIds: [...excluded].sort(),
  }
}

/** `WR/TE` and `WR,TE` both mean two positions; the optimizer compares uppercase strings exactly. */
function positionsOf(position: string | null | undefined): string[] {
  return String(position ?? '')
    .split(/[/,]/)
    .map((p) => p.trim().toUpperCase())
    .map((p) => (p === 'DST' ? 'DEF' : p))
    .filter(Boolean)
}

/** The line a week must fall under, and how many scored weeks in a row it takes. */
export const LINEUP_INTEGRITY_THRESHOLD: Record<IntegritySensitivity, { below: number; weeks: number }> = {
  low: { below: 0.8, weeks: 3 },
  medium: { below: 0.85, weeks: 2 },
  high: { below: 0.9, weeks: 2 },
}

export type ScoredWeek = { week: number; ratio: number | null }

/**
 * The run of scored weeks below the line, ending at the latest scored week. Unscored weeks (null) are
 * stepped over: they are absent evidence, not good behaviour.
 */
export function lowWeekRun(weeks: readonly ScoredWeek[], below: number): number[] {
  const scored = [...weeks].filter((w) => typeof w.ratio === 'number').sort((a, b) => a.week - b.week)
  const run: number[] = []
  for (let i = scored.length - 1; i >= 0; i--) {
    if ((scored[i].ratio as number) < below) run.unshift(scored[i].week)
    else break
  }
  return run
}

export function lineupIntegrityPattern(
  weeks: readonly ScoredWeek[],
  sensitivity: IntegritySensitivity,
): { pattern: boolean; run: number[]; below: number; needed: number } {
  const { below, weeks: needed } = LINEUP_INTEGRITY_THRESHOLD[sensitivity]
  const run = lowWeekRun(weeks, below)
  return { pattern: run.length >= needed, run, below, needed }
}

/** One step milder when the team cannot benefit from losing. Never below `low`. */
export function adjustForPickOwnership(severity: TankingSeverity, ownsOwnFirst: boolean | null): TankingSeverity {
  if (ownsOwnFirst !== false) return severity
  return severity === 'high' ? 'medium' : 'low'
}

export function pickOwnershipNote(ownsOwnFirst: boolean | null, season: number | null): string | null {
  if (ownsOwnFirst == null) return null
  const which = season != null ? `${season} ` : ''
  return ownsOwnFirst
    ? `Owns its own ${which}first-round pick, so a worse finish would improve its draft position.`
    : `Does not own its own ${which}first-round pick, so losing would not help its draft position. Risk lowered one level.`
}

export function percent(ratio: number): number {
  return Math.round(ratio * 100)
}

/**
 * The line a commissioner can post: what they started against what they could have started.
 * "Started 9 of 9 highest-projected players (100%)".
 */
export function describeWeekScore(s: { week: number; startedTopCount: number; starterCount: number; ratio: number }): string {
  return `Week ${s.week}: started ${s.startedTopCount} of ${s.starterCount} highest-projected players (${percent(s.ratio)}% of the best possible projection).`
}

export type TeamScoreSummary = {
  weeksScored: number
  averageRatio: number | null
  lowestWeek: { week: number; ratio: number } | null
  fullWeeks: number
}

export function summarizeTeamScores(
  weeks: readonly { week: number; ratio: number | null; startedTopCount: number | null; starterCount: number | null }[],
): TeamScoreSummary {
  const scored = weeks.filter((w): w is { week: number; ratio: number; startedTopCount: number | null; starterCount: number | null } => typeof w.ratio === 'number')
  if (scored.length === 0) return { weeksScored: 0, averageRatio: null, lowestWeek: null, fullWeeks: 0 }
  const lowest = scored.reduce((lo, w) => (w.ratio < lo.ratio ? w : lo))
  return {
    weeksScored: scored.length,
    averageRatio: scored.reduce((s, w) => s + w.ratio, 0) / scored.length,
    lowestWeek: { week: lowest.week, ratio: lowest.ratio },
    fullWeeks: scored.filter((w) => w.startedTopCount != null && w.starterCount != null && w.startedTopCount >= w.starterCount).length,
  }
}

/** The shareable report a commissioner posts to the league: the team's season, one line per week. */
export function buildLineupReportText(input: {
  teamName: string
  season: number
  weeks: readonly { week: number; ratio: number | null; startedTopCount: number | null; starterCount: number | null; skipReason?: string | null }[]
}): string {
  const lines = [`Lineup Integrity report — ${input.teamName}, ${input.season}`]
  const sorted = [...input.weeks].sort((a, b) => a.week - b.week)
  for (const w of sorted) {
    if (typeof w.ratio === 'number' && w.startedTopCount != null && w.starterCount != null) {
      lines.push(describeWeekScore({ week: w.week, ratio: w.ratio, startedTopCount: w.startedTopCount, starterCount: w.starterCount }))
    } else {
      lines.push(`Week ${w.week}: not scored (not enough projections to judge).`)
    }
  }
  const summary = summarizeTeamScores(sorted)
  if (summary.averageRatio != null) {
    lines.push(`Season: ${percent(summary.averageRatio)}% of the best possible projection on average, across ${summary.weeksScored} scored ${summary.weeksScored === 1 ? 'week' : 'weeks'}.`)
  }
  lines.push('Scored from the projections each manager could see when their players’ games started. Players who could not play are left out of the best lineup.')
  return lines.join('\n')
}

/**
 * This week's score on the cross-league board — per row, and one record across every lineup.
 *
 * ⚠ NOT A SECOND LOAD. The input is the rail's `getRailMatchups` result, which the /core shell
 * reads once per render and hands to screens as `ctx.weekLineups` (see `weekLineups.ts`). The rail
 * already draws each league's score one at a time; what no surface said is the AGGREGATE — "you
 * are ahead in 4 of 7" — which is the weekend question a manager with many leagues actually has.
 *
 * ⚠ ONLY THIS WEEK'S LIVE CACHE COUNTS. A `history_fallback` matchup is the newest week the
 * importer happened to keep, which the rail labels LAST; counting it here would put last week's
 * result into this week's record with nothing on screen to tell them apart.
 *
 * ⚠ "NO POINTS YET" IS NOT "NOT STARTED". `scored` is false until the fixture carries points, and a
 * lineup whose early starters were shut out also reads zero. The copy says what we know.
 *
 * Client-safe: type imports only.
 */

import type { RailMatchup } from './railMatchups'
import type { WeekLineups } from './weekLineups'

/** Within this, two scores are level — the same tolerance the shell's swing detector uses. */
const LEVEL_POINTS = 0.05

export type RowScore =
  | { kind: 'h2h'; you: number; them: number; lead: 'ahead' | 'behind' | 'level' }
  /** An elimination week: no opponent, only the distance to the lowest score. Null = you ARE lowest. */
  | { kind: 'cut'; overCut: number | null; rank: number; outOf: number }

export function rowScoreOf(m: RailMatchup | null | undefined): RowScore | null {
  if (!m || m.source !== 'live_cache' || !m.scored) return null
  if (m.unpaired) {
    const s = m.standing
    /* Ranked on projections means nobody has scored yet — that is not a place on the table. */
    if (!s || !s.elimination || s.basis !== 'points') return null
    return { kind: 'cut', overCut: s.overCut, rank: s.rank, outOf: s.outOf }
  }
  const d = m.yourScore - m.opponentScore
  return {
    kind: 'h2h',
    you: m.yourScore,
    them: m.opponentScore,
    lead: Math.abs(d) < LEVEL_POINTS ? 'level' : d > 0 ? 'ahead' : 'behind',
  }
}

export type WeekScoreSummary = {
  ahead: number
  behind: number
  level: number
  aboveCut: number
  onCut: number
  /** This week's fixture is on file and carries no points yet. */
  noPointsYet: number
}

/**
 * The record across `leagueIds` — the board's own leagues, so a paused or eliminated league the
 * board excludes never counts toward it. Null when not one of them has a score yet: a record of
 * "0–0" before kickoff says nothing a manager needs.
 */
export function summariseWeekScores(
  lineups: WeekLineups | null | undefined,
  leagueIds: Iterable<string>,
): WeekScoreSummary | null {
  if (!lineups) return null
  const out: WeekScoreSummary = { ahead: 0, behind: 0, level: 0, aboveCut: 0, onCut: 0, noPointsYet: 0 }
  for (const id of new Set(leagueIds)) {
    const m = lineups.byLeague[id]
    if (!m || m.source !== 'live_cache') continue
    const score = rowScoreOf(m)
    if (!score) {
      if (!m.scored) out.noPointsYet += 1
      continue
    }
    if (score.kind === 'h2h') out[score.lead] += 1
    else if (score.overCut == null) out.onCut += 1
    else out.aboveCut += 1
  }
  const scored = out.ahead + out.behind + out.level + out.aboveCut + out.onCut
  return scored > 0 ? out : null
}

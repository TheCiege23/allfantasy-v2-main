/**
 * Pure shaping for the Record Book reads (lib/league-settings-hub/recordBookReads.ts). No Prisma,
 * no loader imports — so unit tests and client code can use these without the server data chain.
 */

import type { StoryData } from '@/lib/storyline-studio/types'

export type PlayerHighScoreRow = {
  rank: number
  playerId: string
  playerName: string
  teamName: string
  season: number
  week: number
  points: number
}

/**
 * The biggest single-week STARTER scores. Bench points never counted for anyone, and a player the
 * loader could not name is left out (the story loader never writes about an unnamed player either).
 */
export function topPlayerScores(
  data: Pick<StoryData, 'playerWeeks' | 'playerNames' | 'teams'>,
  limit = 10,
): PlayerHighScoreRow[] {
  return data.playerWeeks
    .filter((w) => w.starter && w.points > 0 && data.playerNames.has(w.playerId) && data.teams.has(w.team))
    .slice()
    .sort((a, b) => b.points - a.points || b.season - a.season || a.week - b.week)
    .slice(0, Math.max(0, limit))
    .map((w, i) => ({
      rank: i + 1,
      playerId: w.playerId,
      playerName: data.playerNames.get(w.playerId)!,
      teamName: data.teams.get(w.team)!.name,
      season: w.season,
      week: w.week,
      points: Math.round(w.points * 100) / 100,
    }))
}

export type TeamHighScoreRow = {
  rank: number
  teamName: string
  season: number
  week: number
  points: number
}

/**
 * The biggest single-week TEAM scores from final head-to-head results — both sides of every final
 * fixture. A scheduled or live game (`final: false`) is not a result and never counts.
 */
export function topTeamScores(data: Pick<StoryData, 'fixtures' | 'teams'>, limit = 10): TeamHighScoreRow[] {
  const sides: Array<{ team: string; season: number; week: number; points: number }> = []
  for (const f of data.fixtures) {
    if (!f.final) continue
    sides.push({ team: f.a, season: f.season, week: f.week, points: f.scoreA }, { team: f.b, season: f.season, week: f.week, points: f.scoreB })
  }
  return sides
    .filter((s) => s.points > 0 && data.teams.has(s.team))
    .sort((a, b) => b.points - a.points || b.season - a.season || a.week - b.week)
    .slice(0, Math.max(0, limit))
    .map((s, i) => ({ rank: i + 1, teamName: data.teams.get(s.team)!.name, season: s.season, week: s.week, points: Math.round(s.points * 100) / 100 }))
}

/** One starter whose points the league office's stats changed after the week sealed. */
export type CorrectionChange = {
  player: string
  position: string | null
  team: string
  before: number
  after: number
  delta: number
}

export type CorrectionWeek = {
  week: number
  /** Every stored score for the week is finalized — past the stat-correction window. */
  final: boolean
  /** When the week was last rescored after stat corrections, if ever. ISO string. */
  rescoredAt: string | null
  /**
   * The players the stat-correction check found changed (lib/stat-corrections/statCorrectionDetector),
   * biggest change first. `[]` = the week was checked and nothing moved; absent = never checked (an
   * imported league, a sport the check does not cover, or a week it has not reached).
   */
  changes?: CorrectionChange[]
}

/**
 * Joins the detector's stored per-week reviews onto the weeks. A reviewed week the score rows do not
 * list is still shown — the review is the evidence that it was played and checked.
 */
export function attachCorrectionChanges(
  weeks: ReadonlyArray<CorrectionWeek>,
  reviews: ReadonlyArray<{ week: number; changes: ReadonlyArray<CorrectionChange> }>,
): CorrectionWeek[] {
  const byWeek = new Map(weeks.map((w) => [w.week, { ...w }]))
  for (const r of reviews) {
    const w = byWeek.get(r.week) ?? { week: r.week, final: false, rescoredAt: null }
    w.changes = [...r.changes].sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta) || a.player.localeCompare(b.player))
    byWeek.set(r.week, w)
  }
  return [...byWeek.values()].sort((a, b) => a.week - b.week)
}

/**
 * Per-week finalization from grouped score rows, joined with the reprocess markers. A week is
 * final only when it has finalized rows and NO unfinalized ones — a half-finalized week can move.
 */
export function summarizeCorrectionWeeks(
  groups: ReadonlyArray<{ week: number; isFinalized: boolean; count: number }>,
  reprocessed: ReadonlyArray<{ week: number; createdAt: Date }>,
): CorrectionWeek[] {
  const byWeek = new Map<number, { finalized: number; open: number }>()
  for (const g of groups) {
    const cur = byWeek.get(g.week) ?? { finalized: 0, open: 0 }
    if (g.isFinalized) cur.finalized += g.count
    else cur.open += g.count
    byWeek.set(g.week, cur)
  }
  const latest = new Map<number, Date>()
  for (const r of reprocessed) {
    const prev = latest.get(r.week)
    if (!prev || r.createdAt > prev) latest.set(r.week, r.createdAt)
    if (!byWeek.has(r.week)) byWeek.set(r.week, { finalized: 0, open: 0 })
  }
  return [...byWeek.entries()]
    .sort(([a], [b]) => a - b)
    .map(([week, c]) => ({
      week,
      final: c.finalized > 0 && c.open === 0,
      rescoredAt: latest.get(week)?.toISOString() ?? null,
    }))
}

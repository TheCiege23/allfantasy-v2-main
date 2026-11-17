/**
 * The running season follows the commissioner's playoff start week (2026-11-15).
 *
 * 🛑 THE SETTING AND THE SEASON NEVER MET. The quick "Playoff start week" field writes `League.playoffStartWeek`
 * (lib/playoff-settings/resolvePlayoffStartWeek.ts calls it the source of truth), but a season that already exists
 * runs on its own `RedraftSeason.playoffStartWeek` — the schedule, standings, the median game and the playoffs all
 * read that — and nothing ever updated it. A commissioner who moved the playoffs after the draft changed nothing.
 *
 * Now a change reaches the current season: its playoff start moves (the playoff length is kept), and the weeks that
 * have not started are rebuilt for the new regular-season length. Weeks already played are never touched.
 *
 *   - before week 1: applied directly;
 *   - mid-season: only with the mid-season confirmation the settings window already asks for, since future
 *     matchups change;
 *   - a start in a week that has already begun: refused, with the earliest week that works.
 */
export type SeasonForPlayoffSync = {
  id: string
  status: string
  currentWeek: number
  totalWeeks: number
  playoffStartWeek: number
}

export type PlayoffStartSyncPlan =
  | { kind: 'none' }
  | { kind: 'refuse_past'; message: string }
  | { kind: 'needs_confirmation' }
  | { kind: 'apply'; seasonId: string; playoffStartWeek: number; totalWeeks: number; midSeason: boolean }

const RUNNING = new Set(['setup', 'active'])

/** What a new playoff start week means for the current season. Pure. */
export function planSeasonPlayoffStartSync(
  season: SeasonForPlayoffSync | null,
  newStart: number,
  confirmed: boolean,
): PlayoffStartSyncPlan {
  if (!season || !RUNNING.has(season.status) || !Number.isInteger(newStart) || newStart < 2) return { kind: 'none' }
  if (season.playoffStartWeek === newStart) return { kind: 'none' }
  const started = season.currentWeek > 0
  if (started && newStart <= season.currentWeek) {
    return {
      kind: 'refuse_past',
      message: `Week ${season.currentWeek} has already begun, so the playoffs can start in week ${season.currentWeek + 1} at the earliest.`,
    }
  }
  if (started && !confirmed) return { kind: 'needs_confirmation' }
  const playoffWeeks = Math.max(1, season.totalWeeks - season.playoffStartWeek + 1)
  return { kind: 'apply', seasonId: season.id, playoffStartWeek: newStart, totalWeeks: newStart + playoffWeeks - 1, midSeason: started }
}

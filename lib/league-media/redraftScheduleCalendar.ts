/**
 * Schedule tab (batch A6): the season calendar — one cell per week, with the trade deadline, the
 * playoff weeks and the championship marked.
 *
 * 🛑 REAL DATA ONLY, the same rule as the header's season track (lib/league-media/redraftSeasonTrack.ts):
 *   - regular-season cells come from the schedule's own `weeks` (what was generated), never from a
 *     sport default;
 *   - playoff cells exist only when BOTH `playoffStartWeek` and `totalWeeks` (RedraftSeason.totalWeeks)
 *     are known and the playoffs start inside the season. `playoffStartWeek > totalWeeks` is how a
 *     no-playoff season is recorded (finalizeDraftToRedraftSeason.ts) — then there are none;
 *   - the trade deadline (League.tradeDeadlineWeek) is marked only on a week the calendar has. An
 *     unset or out-of-season deadline is dropped, not clamped.
 *
 * Pure, so the mapping is unit-tested without rendering anything.
 */

export type CalendarWeekInput = { week: number; status: string; isCurrent?: boolean; matchups?: unknown[] }

export type ScheduleCalendarInput = {
  weeks: CalendarWeekInput[]
  currentWeek?: number | null
  playoffStartWeek?: number | null
  totalWeeks?: number | null
  tradeDeadlineWeek?: number | null
}

export type CalendarCell = {
  week: number
  kind: 'regular' | 'playoff'
  /** done = played, now = the league's current week, upcoming = not yet. */
  state: 'done' | 'now' | 'upcoming'
  deadline: boolean
  /** The first playoff week. */
  playoffStart: boolean
  championship: boolean
  /** A regular week with matchups to show; playoff weeks have none in the schedule runtime. */
  selectable: boolean
}

export type ScheduleCalendar = {
  cells: CalendarCell[]
  /** The deadline week actually marked, or null when it was dropped. */
  deadlineWeek: number | null
  playoffStartWeek: number | null
  championshipWeek: number | null
}

const posInt = (v: unknown): number | null => (typeof v === 'number' && Number.isInteger(v) && v > 0 ? v : null)

export function buildScheduleCalendar(input: ScheduleCalendarInput): ScheduleCalendar {
  const current = posInt(input.currentWeek)
  const total = posInt(input.totalWeeks)
  const playoffStart = posInt(input.playoffStartWeek)
  const stateFor = (week: number, status?: string): CalendarCell['state'] => {
    if (current != null) return week < current ? 'done' : week === current ? 'now' : 'upcoming'
    return status === 'completed' || status === 'locked' ? 'done' : 'upcoming'
  }

  const regular = [...input.weeks]
    .filter(w => posInt(w.week) != null)
    .sort((a, b) => a.week - b.week)
    .filter(w => playoffStart == null || w.week < playoffStart)
  const cells: CalendarCell[] = regular.map(w => ({
    week: w.week,
    kind: 'regular',
    state: stateFor(w.week, w.status),
    deadline: false,
    playoffStart: false,
    championship: false,
    selectable: Array.isArray(w.matchups) ? w.matchups.length > 0 : true,
  }))

  const hasPlayoffs = playoffStart != null && total != null && playoffStart <= total
  if (hasPlayoffs) {
    const lastRegular = cells.length ? cells[cells.length - 1]!.week : 0
    for (let week = Math.max(playoffStart, lastRegular + 1); week <= total; week += 1) {
      cells.push({
        week,
        kind: 'playoff',
        state: stateFor(week),
        deadline: false,
        playoffStart: week === playoffStart,
        championship: week === total,
        selectable: false,
      })
    }
  }

  const deadline = posInt(input.tradeDeadlineWeek)
  const deadlineCell = deadline == null ? undefined : cells.find(c => c.week === deadline)
  if (deadlineCell) deadlineCell.deadline = true

  return {
    cells,
    deadlineWeek: deadlineCell ? deadlineCell.week : null,
    playoffStartWeek: hasPlayoffs ? playoffStart : null,
    championshipWeek: hasPlayoffs ? total : null,
  }
}

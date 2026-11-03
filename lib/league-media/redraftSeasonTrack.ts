/**
 * The redraft header's season track: "Week X of N", a progress fill, and markers for the draft, now,
 * the trade deadline, the playoffs and the championship.
 *
 * 🛑 REAL DATA ONLY. Every marker is built from a value the league actually carries; a marker whose
 * value is missing is DROPPED, never estimated. In particular:
 *   - no total weeks  → no "of N", no fill, no championship marker, and markers carry no position
 *     (the header lists them as chips instead of placing them on a bar);
 *   - playoffs start after the last week (`playoffStartWeek > totalWeeks`, which is how
 *     finalizeDraftToRedraftSeason.ts records a season with no playoffs) → no playoff and no
 *     championship marker;
 *   - a sport default playoff week is NOT league data — callers pass only the league's own week
 *     (`RedraftSeason.playoffStartWeek`, else `readChosenPlayoffStartWeek`).
 *
 * Pure, so the mapping is unit-tested without rendering anything.
 */

export type RedraftSeasonFacts = {
  /** The week the league is in (RedraftSeason.currentWeek, else the league row's week). */
  currentWeek?: number | null
  /** RedraftSeason.totalWeeks — the whole season including playoffs. */
  totalWeeks?: number | null
  playoffStartWeek?: number | null
  /** League.tradeDeadlineWeek. */
  tradeDeadlineWeek?: number | null
  /** True once the draft has finished (a RedraftSeason exists, or the lifecycle is past the draft). */
  draftComplete: boolean
  /** The draft is running right now. */
  drafting?: boolean
}

export type SeasonTrackMarkerId = 'draft' | 'now' | 'deadline' | 'playoffs' | 'championship'
export type SeasonTrackMarker = {
  id: SeasonTrackMarkerId
  label: string
  week: number | null
  /** 0..1 along the bar, or null when there is no total to place it against. */
  at: number | null
  state: 'done' | 'now' | 'upcoming'
}
export type SeasonTrack = {
  /** "Week 9 of 17", "Week 9", or null before there is a week. */
  weekLabel: string | null
  /** 0..1, or null when the fill cannot be computed from real data. */
  progress: number | null
  markers: SeasonTrackMarker[]
}

function week(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : null
}

const round3 = (n: number) => Math.round(n * 1000) / 1000

export function buildRedraftSeasonTrack(facts: RedraftSeasonFacts): SeasonTrack {
  const total = week(facts.totalWeeks)
  const current = facts.draftComplete ? week(facts.currentWeek) : null
  const inSeason = (w: number) => total == null || w <= total
  const at = (w: number) => (total == null ? null : round3(Math.min(1, w / total)))
  const stateFor = (w: number): SeasonTrackMarker['state'] => (current != null && current > w ? 'done' : 'upcoming')

  const markers: SeasonTrackMarker[] = []
  markers.push({
    id: 'draft',
    label: facts.draftComplete ? 'Draft ✓' : facts.drafting ? 'Draft · live' : 'Draft',
    week: null,
    at: total == null ? null : 0,
    state: facts.draftComplete ? 'done' : facts.drafting ? 'now' : 'upcoming',
  })
  if (current != null) {
    markers.push({ id: 'now', label: `Week ${current} · now`, week: current, at: at(current), state: 'now' })
  }
  const deadline = week(facts.tradeDeadlineWeek)
  if (deadline != null && inSeason(deadline)) {
    markers.push({ id: 'deadline', label: `Trade deadline · Wk ${deadline}`, week: deadline, at: at(deadline), state: stateFor(deadline) })
  }
  const playoffs = week(facts.playoffStartWeek)
  if (playoffs != null && inSeason(playoffs)) {
    markers.push({ id: 'playoffs', label: `Playoffs · Wk ${playoffs}`, week: playoffs, at: at(playoffs), state: current != null && current >= playoffs ? 'done' : 'upcoming' })
    if (total != null) {
      markers.push({ id: 'championship', label: `Championship · Wk ${total}`, week: total, at: 1, state: current != null && current > total ? 'done' : 'upcoming' })
    }
  }

  return {
    weekLabel: current == null ? null : total == null ? `Week ${current}` : `Week ${current} of ${total}`,
    progress: current == null || total == null ? null : round3(Math.min(1, current / total)),
    markers,
  }
}

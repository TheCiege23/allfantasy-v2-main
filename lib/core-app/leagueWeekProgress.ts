import { leagueWeekFromSettings } from './seasonTimeline'

/** A scored Thursday is still an unfinished fantasy week. */
export function leagueWeekProgress(league: { settings?: unknown; season?: number | null; status?: string | null }) {
  const currentWeek = leagueWeekFromSettings(league.settings)
  const complete = ['complete', 'completed', 'finished'].includes(String(league.status ?? '').toLowerCase())
  return {
    currentWeek,
    isFinal(season: number, week: number): boolean {
      if (league.season != null && season !== league.season) return season < league.season
      if (complete) return true
      return currentWeek != null && week < currentWeek
    },
  }
}

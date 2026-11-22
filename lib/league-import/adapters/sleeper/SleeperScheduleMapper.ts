import type { IExternalScheduleMapper } from '../../mappers/ExternalScheduleMapper'
import type { SleeperImportPayload } from './types'

/**
 * Group Sleeper matchups by matchup_id so we have roster_id_1 vs roster_id_2.
 *
 * A roster with no `matchup_id` has no opponent that week (a playoff bye, or a team out of the
 * bracket). Those used to share one group keyed "null", so the first two were paired as if they had
 * played each other and the rest were dropped. Each is now its own entry with no second roster: its
 * points are kept and no game is invented.
 */
function pairMatchups(matchups: { roster_id: number; matchup_id: number | null; points: number }[]) {
  const byMatchup = new Map<string, { roster_id: number; points: number }[]>()
  let unpaired = 0
  matchups.forEach((m) => {
    const id = Number(m.matchup_id)
    const key = m.matchup_id != null && Number.isFinite(id) && id > 0 ? `m:${id}` : `bye:${(unpaired += 1)}`
    if (!byMatchup.has(key)) byMatchup.set(key, [])
    byMatchup.get(key)!.push({ roster_id: m.roster_id, points: m.points })
  })
  return [...byMatchup.values()].map((pair) => {
    const [a, b] = pair
    return {
      roster_id_1: String(a?.roster_id ?? ''),
      roster_id_2: String(b?.roster_id ?? ''),
      points_1: a?.points,
      points_2: b?.points,
    }
  })
}

/**
 * 🛑 A WEEK NOBODY HAS PLAYED CARRIES NO POINTS INTO THE IMPORT. Sleeper returns every scheduled week
 * with `points: 0` for each roster, and the bootstrap derives a result from points — 0 vs 0 is 'T'. So
 * every unplayed week of the season became a TIE for every team in `TeamPerformance`: 62,988 such rows
 * across 578 Sleeper leagues on a production copy (2026-11-09, weeks 10–18 of a week-9 season). The
 * ESPN adapter fixed the same thing with ESPN's own "undecided" flag; Sleeper sends none, and this
 * repo does not trust its `leg` field (SleeperLeagueFetchService.ts), so the week is judged on its
 * own data: a week where NO roster has a point is unplayed. A played NFL week never has every team on
 * 0. The pairings are kept; the points arrive on the sync after the week is played.
 */
function weekIsUnplayed(matchups: { points: number | null | undefined }[]): boolean {
  return matchups.length > 0 && matchups.every((m) => !m.points)
}

export const SleeperScheduleMapper: IExternalScheduleMapper<SleeperImportPayload> = {
  map(source) {
    const byWeek = source.matchupsByWeek ?? []
    const season = source.league?.season ? parseInt(source.league.season, 10) : new Date().getFullYear()
    return byWeek.map(({ week, matchups }) => ({
      week,
      season: Number.isNaN(season) ? new Date().getFullYear() : season,
      matchups: weekIsUnplayed(matchups)
        ? pairMatchups(matchups).map(({ roster_id_1, roster_id_2 }) => ({ roster_id_1, roster_id_2 }))
        : pairMatchups(matchups),
    }))
  },
}

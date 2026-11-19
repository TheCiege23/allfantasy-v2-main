import 'server-only'

import { resolveByeWeekMap, type ByeWeekMap } from '@/lib/core-app/byeWeekMap'
import { normalizeTeamAbbrev } from '@/lib/team-abbrev'

/**
 * Bye week for a draft-pool row's club, from the schedule we hold (`resolveByeWeekMap`).
 *
 * 🛑 The pool used to hard-code `bye: null` on every row, so the BYE column was blank for
 * every NFL player even though the bye map already existed for waivers and lineups.
 *
 * ⚠ NFL ONLY. College rosters name schools formally ("United States Naval Academy",
 * "University of Mississippi") while the NCAAF schedule uses short names ("Navy", "Ole Miss"),
 * and no map between the two exists yet. Guessing would put wrong byes on the board, which is
 * worse than a blank, so NCAAF returns null until that map is built.
 *
 * A club missing from the map means "we do not know", never "no bye".
 */
export function byeWeekForTeam(map: ByeWeekMap, team: string | null | undefined): number | null {
  const abbrev = normalizeTeamAbbrev(team ?? null)
  if (!abbrev) return null
  const week = map[abbrev]
  return typeof week === 'number' && Number.isFinite(week) ? week : null
}

export async function loadDraftPoolByeWeekMap(sport: string, season: number | null): Promise<ByeWeekMap> {
  if (String(sport).toUpperCase() !== 'NFL') return {}
  if (season == null || !Number.isInteger(season)) return {}
  return resolveByeWeekMap(season, 'NFL').catch(() => ({}))
}

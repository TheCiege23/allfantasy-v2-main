/**
 * Does this league's division count match its real sport's? (owner's page review #17, Phase C3)
 *
 * "With divisions, mirror the real sport's in-division game count when the division count matches the
 * sport's (AFC East plays its division twice; NBA conference counts)." The schedule already has the
 * rematch switch (`division_config.rivalsTwice`, lib/schedule-runtime/canonicalScheduleRuntime.ts), so
 * this says when the league's divisions look like the real thing, and what the real league plays.
 *
 * Twice is the most a weekly season holds. Everyone plays everyone once first; each further meeting with
 * every division rival is another full division round robin. A 15-team NBA-style league playing division
 * rivals 4 times would need 14 + 3 × 5 = 29 weeks, past any fantasy regular season. So the NBA, NHL and
 * MLB notes say what the real league does and that this league can play its rivals twice.
 *
 * Pure. The returned `key` is an i18n key (lib/i18n/translations.ts `division.sportMatch.*`).
 */
export type DivisionSportMatch = {
  /** Real division rival meetings in that sport's season. */
  realMeetings: string
  /** i18n key for the note. */
  key: 'division.sportMatch.nfl' | 'division.sportMatch.nba' | 'division.sportMatch.nhl' | 'division.sportMatch.mlb'
}

const BY_SPORT: Record<string, { divisions: number } & DivisionSportMatch> = {
  // An NFL conference: 4 divisions of 4. Division rivals twice (6 of 17 games).
  NFL: { divisions: 4, realMeetings: '2', key: 'division.sportMatch.nfl' },
  // An NBA conference: 3 divisions of 5. Division rivals 4 times.
  NBA: { divisions: 3, realMeetings: '4', key: 'division.sportMatch.nba' },
  // An NHL conference: 2 divisions of 8. Division rivals 3 or 4 times.
  NHL: { divisions: 2, realMeetings: '3–4', key: 'division.sportMatch.nhl' },
  // An MLB league: 3 divisions of 5. Division rivals 13 times.
  MLB: { divisions: 3, realMeetings: '13', key: 'division.sportMatch.mlb' },
}

export function divisionSportMatch(sport: string | null | undefined, divisionCount: number): DivisionSportMatch | null {
  const hit = BY_SPORT[String(sport ?? '').trim().toUpperCase()]
  if (!hit || divisionCount !== hit.divisions) return null
  return { realMeetings: hit.realMeetings, key: hit.key }
}

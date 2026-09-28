/**
 * Where NCAAF fantasy playoffs fall: they END on the last full week of the college regular season.
 *
 * College football has full slates through week 13. Week 14 is conference championships (about ten
 * games) and week 15 is Army-Navy (one game) — measured on production's CFBD schedule, 2026-09-28.
 * The old defaults started every NCAAF bracket at week 13, so a 4-team final landed on week 14 and a
 * 6-team final on week 15, where nearly every rostered player has no game.
 *
 * Owner's ruling (2026-09-28): the bracket ends on week 13 — a 4-team bracket plays weeks 12-13 after a
 * regular season through week 11; a 6-team bracket plays 11-13 after week 10. In general the start is
 * `13 - rounds × weeksPerRound + 1`.
 */

/** The last college regular-season week with a full slate. */
export const NCAAF_LAST_FULL_WEEK = 13

export type NcaafPlayoffWindow = {
  playoffStartWeek: number
  regularSeasonEndWeek: number
  championshipWeek: number
  rounds: number
}

/** The NCAAF playoff window for a bracket of `playoffTeams`, or null for no bracket (< 2 teams). */
export function ncaafPlayoffWindow(playoffTeams: number, weeksPerRound = 1): NcaafPlayoffWindow | null {
  const teams = Math.floor(Number(playoffTeams))
  if (!Number.isFinite(teams) || teams < 2) return null
  const rounds = Math.ceil(Math.log2(teams))
  const span = rounds * Math.max(1, Math.floor(Number(weeksPerRound)) || 1)
  const playoffStartWeek = Math.max(2, NCAAF_LAST_FULL_WEEK - span + 1)
  return {
    playoffStartWeek,
    regularSeasonEndWeek: playoffStartWeek - 1,
    championshipWeek: playoffStartWeek + span - 1,
    rounds,
  }
}

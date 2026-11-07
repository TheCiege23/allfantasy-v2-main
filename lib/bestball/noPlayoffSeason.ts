/**
 * A Best Ball league with NO playoffs (`best_ball_settings.playoffFormat === 'none'`, or 0 playoff
 * teams): the regular season IS the whole season, and the champion is its leader — the points leader
 * for season-long cumulative scoring, the best record (then points) for head-to-head.
 *
 * One predicate, read by creation (which writes 0 playoff teams and no playoff start week) and by the
 * season engine, which treats such a league exactly as it treats a rotisserie league: the season's
 * length is the regular season, no bracket is opened, and finalization crowns the standings leader
 * (lib/redraft/offseason/finalizeRotoSeason.ts) instead of a fabricated playoff final.
 *
 * A best ball TOURNAMENT is not one of these: its rounds are the post-season and the contest engine
 * owns its season (lib/bestball/tournamentCalendar.ts).
 */

type Obj = Record<string, unknown>

function record(value: unknown): Obj | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Obj) : null
}

/** The saved best ball block says the league has no playoffs. */
export function bestBallSettingsHaveNoPlayoffs(bestBall: unknown): boolean {
  const bb = record(bestBall)
  if (!bb) return false
  if (bb.contestStructure === 'tournament' || bb.tournamentEnabled === true) return false
  if (bb.playoffFormat === 'none') return true
  const teams = Number(bb.playoffTeams)
  return Number.isFinite(teams) && teams <= 0
}

export type NoPlayoffLeagueLike = {
  bestBallMode?: boolean | null
  leagueType?: string | null
  settings?: unknown
}

/** A (non-tournament) Best Ball league whose saved settings have no playoffs. */
export function isBestBallNoPlayoffLeague(league: NoPlayoffLeagueLike | null | undefined): boolean {
  if (!league) return false
  const settings = record(league.settings)
  if (!settings) return false
  const isBestBall =
    league.bestBallMode === true ||
    league.leagueType === 'best_ball' ||
    settings.league_type === 'best_ball' ||
    settings.leagueType === 'best_ball'
  return isBestBall && bestBallSettingsHaveNoPlayoffs(settings.best_ball_settings)
}

/** How the champion of a no-playoff Best Ball season is decided. */
export function noPlayoffChampionRule(settings: unknown): 'points_leader' | 'record_leader' {
  const bb = record(record(settings)?.best_ball_settings)
  return bb?.matchupFormat === 'h2h' && bb.cumulativeScoring !== true ? 'record_leader' : 'points_leader'
}

/** The regular season a no-playoff Best Ball league plays, or null when it has none saved. */
export function noPlayoffBestBallSeasonWeeks(league: NoPlayoffLeagueLike | null | undefined): number | null {
  if (!isBestBallNoPlayoffLeague(league)) return null
  const bb = record(record(league!.settings)?.best_ball_settings)
  const weeks = Math.floor(Number(bb?.regularSeasonLength))
  return Number.isFinite(weeks) && weeks >= 1 ? weeks : null
}

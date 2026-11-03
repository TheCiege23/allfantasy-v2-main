import { getZombieCreationTeamCounts } from '@/lib/zombie/creationPolicy'
/**
 * League size limits by sport — aligned with common ESPN / Sleeper-style caps
 * (every team has one manager; no duplicate slots).
 */

import { TOURNAMENT_TEAMS_PER_LEAGUE } from '@/lib/tournament-mode/tournament-sport-cutoffs'

const MAX_TEAMS_BY_SPORT: Record<string, number> = {
  NFL: 24,
  NBA: 20,
  MLB: 20,
  NHL: 16,
  NCAAF: 20,
  NCAAB: 20,
  SOCCER: 20,
}

const NFL_TEAM_COUNT_OPTIONS = [16, 20, 24] as const

/**
 * The cast sizes a NEW Survivor league is offered (owner's call, 2026-10-20): 12, 15, 16, 18, 20,
 * 21, 22 or 24 managers, split into 2, 3 or 4 EQUAL tribes. Which tribe counts a cast allows
 * follows from that: see `survivorTribeCountOptions`.
 */
export const SURVIVOR_CREATE_CAST_SIZES = [12, 15, 16, 18, 20, 21, 22, 24] as const

/**
 * Every cast size the season engine accepts: the creation sizes plus 17 and 19, which existing
 * leagues from the 16–20 era still carry. `POST /api/league/create` clamps to this list.
 */
export const SURVIVOR_CAST_SIZE_OPTIONS = [12, 15, 16, 17, 18, 19, 20, 21, 22, 24] as const

export const SURVIVOR_CAST_SIZE_MIN = 12
export const SURVIVOR_CAST_SIZE_MAX = 24

/** A Survivor cast is split into this many tribes, never more. */
export const SURVIVOR_TRIBE_COUNT_CHOICES = [2, 3, 4] as const

/**
 * The tribe counts a cast may be split into: the choices that divide it EQUALLY. So 15 and 21 are
 * three tribes only, 22 is two, 16 and 20 are two or four, 18 is two or three, and 12 and 24 may be
 * any of the three. A legacy cast with no equal split (17, 19) keeps any split that leaves at least
 * three managers in the smallest tribe, so those leagues are not orphaned.
 */
export function survivorTribeCountOptions(castSize: number): number[] {
  const equal = SURVIVOR_TRIBE_COUNT_CHOICES.filter((t) => castSize % t === 0)
  if (equal.length > 0) return [...equal]
  return SURVIVOR_TRIBE_COUNT_CHOICES.filter((t) => Math.floor(castSize / t) >= 3)
}

/** Managers per tribe for an equal split; null when the cast does not split that way. */
export function survivorTribeSize(castSize: number, tribeCount: number): number | null {
  return tribeCount > 0 && castSize % tribeCount === 0 ? castSize / tribeCount : null
}

export function clampSurvivorCastSize(raw: number): number {
  const n = Number.isFinite(raw) ? Math.round(raw) : 20
  return SURVIVOR_CAST_SIZE_OPTIONS.reduce((closest, opt) =>
    Math.abs(opt - n) < Math.abs(closest - n) ? opt : closest,
  SURVIVOR_CAST_SIZE_OPTIONS[SURVIVOR_CAST_SIZE_OPTIONS.length - 1])
}

export function getMaxTeamsForSport(sport: string): number {
  return MAX_TEAMS_BY_SPORT[sport] ?? 20
}

function evenTeamRange(min: number, max: number): number[] {
  const out: number[] = []
  const start = min % 2 === 0 ? min : min + 1
  for (let n = start; n <= max; n += 2) out.push(n)
  return out
}

/** Shared with the active wizard, catalog and server validation. */
export function getZombieTeamCountOptionsForSport(sport: string): number[] {
  return getZombieCreationTeamCounts(sport)
}

/** Every integer team count from 4 through the sport maximum (one manager per team). */
export function getTeamCountOptionsForSport(sport: string, leagueType?: string): number[] {
  if (String(leagueType ?? '').toLowerCase() === 'tournament') {
    return [TOURNAMENT_TEAMS_PER_LEAGUE]
  }
  if (String(leagueType ?? '').toLowerCase() === 'zombie') {
    return getZombieTeamCountOptionsForSport(sport)
  }
  if (String(leagueType ?? '').toLowerCase() === 'survivor') {
    return [...SURVIVOR_CAST_SIZE_OPTIONS]
  }
  if (String(leagueType ?? '').toLowerCase() === 'devy' || String(leagueType ?? '').toLowerCase() === 'c2c') {
    const u = sport.toUpperCase()
    if (u === 'NFL') return evenTeamRange(4, 32)
    if (u === 'NBA') return evenTeamRange(4, 30)
    return evenTeamRange(4, 20)
  }
  if (sport.toUpperCase() === 'NFL') {
    return [...NFL_TEAM_COUNT_OPTIONS]
  }
  const max = getMaxTeamsForSport(sport)
  const out: number[] = []
  for (let n = 4; n <= max; n += 1) {
    out.push(n)
  }
  return out
}

function clampDevyEvenTeamCount(sport: string, teamCount: number): number {
  const u = sport.toUpperCase()
  const max = u === 'NFL' ? 32 : u === 'NBA' ? 30 : 20
  const min = 4
  const n = Number.isFinite(teamCount) ? Math.round(teamCount) : 12
  const clamped = Math.min(Math.max(n, min), max)
  return clamped % 2 === 0 ? clamped : clamped + (clamped < max ? 1 : -1)
}

export function clampTeamCountForSport(sport: string, teamCount: number, leagueType?: string): number {
  if (String(leagueType ?? '').toLowerCase() === 'tournament') {
    return TOURNAMENT_TEAMS_PER_LEAGUE
  }
  if (String(leagueType ?? '').toLowerCase() === 'zombie') {
    const opts = getZombieTeamCountOptionsForSport(sport)
    const n = Number.isFinite(teamCount) ? Math.round(teamCount) : 20
    return opts.reduce((closest, opt) => (Math.abs(opt - n) < Math.abs(closest - n) ? opt : closest), opts[0] ?? 20)
  }
  if (String(leagueType ?? '').toLowerCase() === 'survivor') {
    return clampSurvivorCastSize(teamCount)
  }
  if (String(leagueType ?? '').toLowerCase() === 'devy' || String(leagueType ?? '').toLowerCase() === 'c2c') {
    return clampDevyEvenTeamCount(sport, teamCount)
  }
  if (sport.toUpperCase() === 'NFL') {
    const n = Number.isFinite(teamCount) ? Math.round(teamCount) : NFL_TEAM_COUNT_OPTIONS[0]
    return NFL_TEAM_COUNT_OPTIONS.reduce((closest, option) => {
      return Math.abs(option - n) < Math.abs(closest - n) ? option : closest
    }, NFL_TEAM_COUNT_OPTIONS[0])
  }
  const max = getMaxTeamsForSport(sport)
  const n = Number.isFinite(teamCount) ? Math.round(teamCount) : 12
  return Math.min(Math.max(n, 4), max)
}

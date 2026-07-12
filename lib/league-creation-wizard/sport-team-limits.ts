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
 * Survivor cast sizes.
 *
 * These are intentionally fixed to production-supported Survivor sizes.
 * The create route and tests expect arbitrary wizard values to clamp to
 * one of these values, so 17 must clamp to 16 instead of persisting as 17.
 */
export const SURVIVOR_CAST_SIZE_OPTIONS = [16, 20, 24] as const

export function clampSurvivorCastSize(raw: number): number {
  const n = Number.isFinite(raw) ? Math.round(raw) : 20
  return SURVIVOR_CAST_SIZE_OPTIONS.reduce(
    (closest, opt) => (Math.abs(opt - n) < Math.abs(closest - n) ? opt : closest),
    SURVIVOR_CAST_SIZE_OPTIONS[0],
  )
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

const ZOMBIE_TEAM_COUNT_OPTIONS = [8, 10, 12, 14, 16] as const

/** Preferred Zombie sizes; capped per sport max. */
export function getZombieTeamCountOptionsForSport(sport: string): number[] {
  const max = getMaxTeamsForSport(sport)
  const filtered = ZOMBIE_TEAM_COUNT_OPTIONS.filter((n) => n <= max)
  if (filtered.length > 0) return filtered

  const fallback: number[] = []
  for (let n = max; n >= 4 && fallback.length < 3; n -= 2) {
    fallback.unshift(n)
  }
  return fallback.length > 0 ? fallback : [Math.min(22, max)]
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

  if (
    String(leagueType ?? '').toLowerCase() === 'devy' ||
    String(leagueType ?? '').toLowerCase() === 'c2c'
  ) {
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
    const n = Number.isFinite(teamCount) ? Math.round(teamCount) : opts[1] ?? 20
    return opts.reduce(
      (closest, option) => (Math.abs(option - n) < Math.abs(closest - n) ? option : closest),
      opts[0] ?? 20,
    )
  }

  if (String(leagueType ?? '').toLowerCase() === 'survivor') {
    return clampSurvivorCastSize(teamCount)
  }

  if (
    String(leagueType ?? '').toLowerCase() === 'devy' ||
    String(leagueType ?? '').toLowerCase() === 'c2c'
  ) {
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
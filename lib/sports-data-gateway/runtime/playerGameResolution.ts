/**
 * Fantasy OS Phase 5D-c — pure player → canonical team → canonical game resolver (Part 4).
 *
 * Fails closed: unresolved team, stale/missing schedule, or multiple/conflicting games never resolve to a
 * confident game. `bye` is only asserted when the schedule window is certified complete — a free-agent team is
 * NOT a bye, and missing schedule is NOT a bye.
 */
import type { CanonicalGameSchedule } from '../contracts'
import { resolveTeam } from '../teamIdentity'

export type PlayerGameResolutionInput = {
  canonicalPlayerId: string
  playerTeamReference: string | null // Sleeper team abbreviation
  sport: string
  at: string
  games: CanonicalGameSchedule[]
  /** True when the schedule window is certified complete (required to declare a bye). */
  scheduleComplete: boolean
}

export type PlayerGameResolution =
  | { status: 'resolved'; canonicalTeamId: string; canonicalGameId: string; scheduledStart: string; gameStatus: CanonicalGameSchedule['status']; evidence: string[] }
  | { status: 'bye' | 'free_agent' | 'unresolved_team' | 'multiple_games' | 'missing_schedule' | 'conflicting_schedule'; evidence: string[] }

/** Map an ESPN-prefixed game team id (`espn:nfl:team:<id>`) to a canonical team id. */
function gameTeamToCanonical(teamId: string): string | null {
  const m = /^espn:nfl:team:(\d+)$/.exec(teamId)
  if (!m) return null
  const r = resolveTeam({ provider: 'espn', ref: m[1], sport: 'NFL' })
  return r.status === 'resolved' ? r.canonicalTeamId : null
}

export function resolvePlayerGame(input: PlayerGameResolutionInput): PlayerGameResolution {
  const teamRef = (input.playerTeamReference ?? '').trim()
  const teamRes = resolveTeam({ provider: 'sleeper', ref: teamRef, sport: input.sport })
  if (teamRes.status === 'unresolved' && (teamRef === '' || /^(FA|NONE)$/i.test(teamRef))) {
    return { status: 'free_agent', evidence: ['player team is free-agent/empty'] }
  }
  if (teamRes.status !== 'resolved') {
    return { status: 'unresolved_team', evidence: [`team "${teamRef}" did not resolve (${teamRes.status})`] }
  }
  const canonicalTeamId = teamRes.canonicalTeamId

  const matches = input.games.filter((g) => gameTeamToCanonical(g.homeTeamId) === canonicalTeamId || gameTeamToCanonical(g.awayTeamId) === canonicalTeamId)

  if (matches.length === 0) {
    return input.scheduleComplete
      ? { status: 'bye', evidence: [`no game for ${canonicalTeamId} in a certified-complete schedule`] }
      : { status: 'missing_schedule', evidence: [`no game for ${canonicalTeamId} but schedule is not certified complete`] }
  }
  if (matches.length > 1) {
    const starts = new Set(matches.map((m) => m.scheduledStart))
    if (starts.size > 1) return { status: 'conflicting_schedule', evidence: [`${matches.length} games with differing starts for ${canonicalTeamId}`] }
    return { status: 'multiple_games', evidence: [`${matches.length} games for ${canonicalTeamId}`] }
  }
  const g = matches[0]
  return { status: 'resolved', canonicalTeamId, canonicalGameId: g.canonicalGameId, scheduledStart: g.scheduledStart, gameStatus: g.status, evidence: ['single eligible game', `team=${canonicalTeamId}`] }
}

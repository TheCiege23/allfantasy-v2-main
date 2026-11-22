import type { PrismaClient } from '@prisma/client'

import { loadActualWeeklyPoints } from '@/lib/idp-projections/actualWeeklyPoints'
import { extractScoringSettings } from '@/lib/projections/leagueScoring'
import { resolveSportWeek } from '@/lib/season-week/seasonWeekService'

/**
 * The last completed week for a league's Players list, or null when there is none to show.
 *
 * `upcoming` is the week a projection would be for: the week in progress, or the next one once
 * this week's games are all played. The week before it is the last one whose scores are whole.
 */
export function lastCompletedWeek(upcoming: number | null | undefined): number | null {
  if (upcoming == null || !Number.isInteger(upcoming) || upcoming < 2) return null
  return upcoming - 1
}

/**
 * What each listed player scored last week under THIS league's scoring (owner ask, 2026-11-22:
 * Sleeper's Players list shows last week's points; ours had no such figure).
 *
 * NFL only, and that is a data limit, not a choice: `player_game_stats` holds weekly NFL lines under
 * the id a roster carries (the Sleeper id), which is what the list sends. The other sports' lines
 * are stored per game with week 0 and under a different id (production, 2026-11-22), so they need
 * their own reader; until one exists they get no figure rather than a wrong one.
 *
 * A player with no line that week (bye, inactive, not yet ingested) is absent from the map: the
 * screen shows a dash, never 0.0. Any failure returns null and the list is served without the figure.
 */
export async function loadLastWeekPoints(
  prisma: PrismaClient,
  league: { sport: string | null; season: number | null; settings: unknown },
  rosterIds: readonly string[],
  now: Date = new Date(),
): Promise<{ week: number; points: Map<string, number> } | null> {
  try {
    if (String(league.sport ?? '').toUpperCase() !== 'NFL' || !league.season || rosterIds.length === 0) return null
    const scoring = extractScoringSettings(league.settings)
    if (!scoring) return null
    const resolution = await resolveSportWeek('NFL', league.season, { now })
    if (!resolution.ok || resolution.seasonType !== 'regular') return null
    const upcoming = resolution.state === 'played' ? resolution.nextSportWeek : resolution.sportWeek
    const week = lastCompletedWeek(upcoming)
    if (week == null) return null
    const outcomes = await loadActualWeeklyPoints({ prisma, sport: 'NFL', season: league.season, week, playerIds: rosterIds, scoring })
    const points = new Map<string, number>()
    for (const [id, outcome] of outcomes) if (outcome.scored) points.set(id, outcome.points)
    return { week, points }
  } catch {
    return null
  }
}

/** Whose roster a listed player is on. `mine` is the viewer's own team. */
export type RosteredBy = { mine: boolean; team: string | null }

/**
 * Every rostered player id in a league, mapped to the team that holds it.
 *
 * A team's name is its `LeagueTeam` row, joined the way the waiver run does it (the roster's
 * `platformUserId` is that row's `externalId`). A team with no such row is named null and the
 * screen says "Rostered".
 */
export function rosterOwnership(
  rosters: ReadonlyArray<{ id: string; platformUserId?: string | null; playerIds: readonly string[] }>,
  teams: ReadonlyArray<{ externalId: string; teamName?: string | null; ownerName?: string | null }>,
  myRosterId: string | null,
): Map<string, RosteredBy> {
  const nameByExternalId = new Map<string, string>()
  for (const team of teams) {
    const name = String(team.teamName ?? '').trim() || String(team.ownerName ?? '').trim()
    if (name) nameByExternalId.set(team.externalId, name)
  }
  const out = new Map<string, RosteredBy>()
  for (const roster of rosters) {
    const by: RosteredBy = {
      mine: myRosterId != null && roster.id === myRosterId,
      team: (roster.platformUserId ? nameByExternalId.get(roster.platformUserId) : undefined) ?? null,
    }
    for (const id of roster.playerIds) if (!out.has(id)) out.set(id, by)
  }
  return out
}

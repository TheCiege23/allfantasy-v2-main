/**
 * Resolve rosterId <-> teamId (LeagueTeam.id) for a league. PROMPT 353.
 * MatchupFact and TeamPerformance use teamId; Zombie engine uses rosterId.
 * We build map by draft slot order (roster index = team index) or by roster/team count alignment.
 */

import { prisma } from '@/lib/prisma'
import type { RosterTeamMap } from './types'
import { CURRENT_DRAFT_SESSION_ORDER } from '@/lib/draft-room/currentDraftSession'

/**
 * Get roster <-> team mapping for a league. Uses draft slot order when available;
 * otherwise zips rosters and teams by id order (same count).
 */
export async function getRosterTeamMap(leagueId: string): Promise<RosterTeamMap> {
  const [rosters, teams, session] = await Promise.all([
    prisma.roster.findMany({
      where: { leagueId },
      select: { id: true, platformUserId: true },
      orderBy: { id: 'asc' },
    }),
    prisma.leagueTeam.findMany({
      where: { leagueId },
      select: { id: true, externalId: true },
      orderBy: [{ currentRank: 'asc' }, { id: 'asc' }],
    }),
    prisma.draftSession.findFirst({
      where: { leagueId },
      orderBy: CURRENT_DRAFT_SESSION_ORDER,
      select: { slotOrder: true },
    }),
  ])

  const rosterIdToTeamId = new Map<string, string>()
  const teamIdToRosterId = new Map<string, string>()

  const rosterIdByKnownKey = new Map<string, string>()
  for (const roster of rosters) {
    rosterIdByKnownKey.set(roster.id, roster.id)
    if (roster.platformUserId) {
      rosterIdByKnownKey.set(roster.platformUserId, roster.id)
    }
  }

  const matchedRosterIds = new Set<string>()
  const matchedTeamIds = new Set<string>()
  for (const team of teams) {
    const directRosterId = rosterIdByKnownKey.get(team.externalId)
    if (!directRosterId) continue
    rosterIdToTeamId.set(directRosterId, team.id)
    teamIdToRosterId.set(team.id, directRosterId)
    matchedRosterIds.add(directRosterId)
    matchedTeamIds.add(team.id)
  }

  if (matchedRosterIds.size === rosters.length && matchedTeamIds.size === teams.length) {
    return { rosterIdToTeamId, teamIdToRosterId }
  }

  const unmatchedRosters = rosters.filter((roster) => !matchedRosterIds.has(roster.id))
  const unmatchedTeams = teams.filter((team) => !matchedTeamIds.has(team.id))
  if (unmatchedRosters.length !== unmatchedTeams.length) {
    return { rosterIdToTeamId, teamIdToRosterId }
  }

  const slotOrder = session?.slotOrder as Array<{ slot: number; rosterId: string }> | null
  if (Array.isArray(slotOrder) && slotOrder.length === rosters.length) {
    const rosterBySlot = new Map<number, string>()
    for (const o of slotOrder) {
      if (o?.rosterId != null && typeof o.slot === 'number') rosterBySlot.set(o.slot, String(o.rosterId))
    }
    const unmatchedRosterBySlot = new Map<number, string>()
    const unmatchedRosterSet = new Set(unmatchedRosters.map((roster) => roster.id))
    for (const [slot, rosterId] of rosterBySlot.entries()) {
      if (unmatchedRosterSet.has(rosterId)) unmatchedRosterBySlot.set(slot, rosterId)
    }
    for (let i = 0; i < unmatchedTeams.length; i++) {
      const rosterId = unmatchedRosterBySlot.get(i + 1) ?? unmatchedRosters[i]?.id
      const teamId = unmatchedTeams[i]?.id
      if (rosterId && teamId) {
        rosterIdToTeamId.set(rosterId, teamId)
        teamIdToRosterId.set(teamId, rosterId)
      }
    }
  } else {
    for (let i = 0; i < unmatchedRosters.length; i++) {
      const rosterId = unmatchedRosters[i]?.id
      const teamId = unmatchedTeams[i]?.id
      if (rosterId && teamId) {
        rosterIdToTeamId.set(rosterId, teamId)
        teamIdToRosterId.set(teamId, rosterId)
      }
    }
  }

  return { rosterIdToTeamId, teamIdToRosterId }
}

/**
 * Get weekly score for a roster (from TeamPerformance via teamId).
 */
export async function getRosterWeeklyScore(
  leagueId: string,
  rosterId: string,
  season: number,
  week: number
): Promise<number> {
  const map = await getRosterTeamMap(leagueId)
  const teamId = map.rosterIdToTeamId.get(rosterId)
  if (!teamId) return 0
  const perf = await prisma.teamPerformance.findFirst({
    where: { teamId, season, week },
    select: { points: true },
  })
  return perf?.points ?? 0
}

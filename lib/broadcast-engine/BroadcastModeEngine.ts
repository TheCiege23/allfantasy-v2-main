/**
 * BroadcastModeEngine — assembles payload for league broadcast mode (matchups, scores, standings, storylines, rivalries).
 */

import { prisma } from '@/lib/prisma'
import { listDramaEvents } from '@/lib/drama-engine/DramaQueryService'
import { listRivalries } from '@/lib/rivalry-engine/RivalryQueryService'
import { normalizeToSupportedSport } from '@/lib/sport-scope'
import { ACTIVE_TEAM_WHERE } from '@/lib/league-import/activeTeams'
import type {
  BroadcastPayload,
  BroadcastStandingRow,
  BroadcastMatchupRow,
  BroadcastStorylineRow,
  BroadcastRivalryRow,
} from './types'

export interface BroadcastPayloadOptions {
  leagueId: string
  sport?: string | null
  week?: number | null
}

/**
 * Build full broadcast payload: standings, matchups, storylines, rivalries.
 */
export async function getBroadcastPayload(
  options: BroadcastPayloadOptions
): Promise<BroadcastPayload> {
  const { leagueId, sport: sportInput, week: requestedWeek } = options
  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: { name: true, sport: true, season: true },
  })
  const sport = normalizeToSupportedSport(sportInput ?? league?.sport)

  const [teams, matchupFacts, dramaEvents, rivalries] = await Promise.all([
    /* Broadcast mode presents the league as it stands now. */
    prisma.leagueTeam.findMany({
      where: { ...ACTIVE_TEAM_WHERE, leagueId },
      orderBy: [{ currentRank: 'asc' }, { pointsFor: 'desc' }, { wins: 'desc' }],
    }),
    getMatchupsForBroadcast(leagueId, requestedWeek ?? null),
    listDramaEvents(leagueId, { sport, limit: 10 }),
    listRivalries(leagueId, { sport, limit: 10 }),
  ])

  const teamById = new Map(teams.map((t) => [t.id, t]))
  const teamByExternalId = new Map(teams.map((t) => [t.externalId, t]))
  const ownerNameByManagerId = new Map<string, string>()
  teams.forEach((team) => {
    ownerNameByManagerId.set(team.id, team.ownerName)
    if (team.externalId) ownerNameByManagerId.set(team.externalId, team.ownerName)
  })

  const standings: BroadcastStandingRow[] = teams.map((t, i) => ({
    teamId: t.id,
    teamName: t.teamName,
    ownerName: t.ownerName,
    wins: t.wins,
    losses: t.losses,
    ties: t.ties ?? 0,
    pointsFor: t.pointsFor,
    pointsAgainst: t.pointsAgainst,
    rank: t.currentRank ?? i + 1,
  }))

  const matchups: BroadcastMatchupRow[] = matchupFacts.map((m) => {
    const teamA = teamById.get(m.teamA) ?? teamByExternalId.get(m.teamA)
    const teamB = teamById.get(m.teamB) ?? teamByExternalId.get(m.teamB)
    return {
      matchupId: m.matchupId,
      teamAId: m.teamA,
      teamAName: teamA?.teamName ?? m.teamA,
      teamBId: m.teamB,
      teamBName: teamB?.teamName ?? m.teamB,
      scoreA: m.scoreA,
      scoreB: m.scoreB,
      winnerTeamId: m.winnerTeamId,
      weekOrPeriod: m.weekOrPeriod,
      season: m.season,
    }
  })

  const storylines: BroadcastStorylineRow[] = dramaEvents.map((e) => ({
    id: e.id,
    headline: e.headline,
    summary: e.summary ?? null,
    dramaType: e.dramaType,
    dramaScore: e.dramaScore,
    createdAt: e.createdAt.toISOString(),
  }))

  const rivalriesWithNames: BroadcastRivalryRow[] = rivalries.map((r) => {
    const nameA = ownerNameByManagerId.get(r.managerAId) ?? r.managerAId
    const nameB = ownerNameByManagerId.get(r.managerBId) ?? r.managerBId
    return {
      id: r.id,
      managerAId: r.managerAId,
      managerBId: r.managerBId,
      managerAName: nameA,
      managerBName: nameB,
      intensityScore: r.rivalryScore,
      eventCount: r.eventCount ?? 0,
    }
  })

  const currentWeek = matchupFacts.length > 0 ? matchupFacts[0].weekOrPeriod : null
  const season = league?.season ?? (matchupFacts.length > 0 ? matchupFacts[0].season : null)

  return {
    leagueId,
    leagueName: league?.name ?? null,
    sport: league?.sport ?? sport,
    standings,
    matchups,
    storylines,
    rivalries: rivalriesWithNames,
    currentWeek,
    season,
    fetchedAt: new Date().toISOString(),
  }
}

async function getMatchupsForBroadcast(
  leagueId: string,
  requestedWeek: number | null
): Promise<Array<{ matchupId: string; teamA: string; teamB: string; scoreA: number; scoreB: number; winnerTeamId: string | null; weekOrPeriod: number; season: number | null }>> {
  const orderBy = requestedWeek != null
    ? [{ weekOrPeriod: 'asc' as const }, { matchupId: 'asc' as const }]
    : [{ weekOrPeriod: 'desc' as const }, { matchupId: 'asc' as const }]

  const where = requestedWeek != null
    ? { leagueId, weekOrPeriod: requestedWeek }
    : { leagueId }

  const facts = await prisma.matchupFact.findMany({
    where,
    orderBy,
    take: 50,
  })

  return facts.map((m) => ({
    matchupId: m.matchupId,
    teamA: m.teamA,
    teamB: m.teamB,
    scoreA: m.scoreA,
    scoreB: m.scoreB,
    winnerTeamId: m.winnerTeamId,
    weekOrPeriod: m.weekOrPeriod,
    season: m.season,
  }))
}

/**
 * Start a broadcast session (persist BroadcastSession).
 */
export async function startBroadcastSession(
  leagueId: string,
  options: { sport?: string | null; createdBy?: string | null }
) {
  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: { sport: true },
  })
  const sport = normalizeToSupportedSport(options.sport ?? league?.sport)

  const session = await prisma.broadcastSession.create({
    data: {
      leagueId,
      sport,
      createdBy: options.createdBy ?? null,
    },
  })
  return { sessionId: session.id, leagueId, sport, startedAt: session.startedAt }
}

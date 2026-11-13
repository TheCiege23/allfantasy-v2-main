/**
 * [NEW] lib/tournament-mode/TournamentChampionService.ts
 * Crown the tournament winner, lock the tournament, post champion announcement.
 */

import { prisma } from '@/lib/prisma'
import { compareByTiebreakers } from './advancement-rules'
import { logTournamentAudit } from './TournamentAuditService'
import { createLeagueChatMessage } from '@/lib/league-chat/LeagueChatMessageService'

interface ChampionResult {
  championUserId: string
  championTeamName: string | null
  tournamentName: string
  finalLeagueId: string
  totalRounds: number
}

/**
 * Crown the tournament champion from the championship league's final standings.
 * Locks the tournament, posts an announcement, and marks the winner.
 */
export async function crownChampion(tournamentId: string): Promise<ChampionResult> {
  const tournament = await prisma.legacyTournament.findUnique({
    where: { id: tournamentId },
    include: { rounds: { orderBy: { roundIndex: 'desc' }, take: 1 } },
  })
  if (!tournament) throw new Error('Tournament not found')
  if (tournament.status === 'completed') throw new Error('Tournament already completed')

  const finalRound = tournament.rounds[0]
  if (!finalRound || finalRound.phase !== 'championship') {
    throw new Error('Championship round has not been created yet')
  }

  // Find the championship league
  const champLeague = await prisma.legacyTournamentLeague.findFirst({
    where: { tournamentId, roundIndex: finalRound.roundIndex, phase: 'championship' },
    include: { league: { select: { id: true, name: true } } },
  })
  if (!champLeague) throw new Error('Championship league not found')

  // Get standings from the championship league
  const rosters = await prisma.roster.findMany({
    where: { leagueId: champLeague.leagueId },
    select: { id: true, platformUserId: true },
  })
  const matchups = await prisma.matchupFact.findMany({
    where: { leagueId: champLeague.leagueId },
    select: { teamA: true, teamB: true, scoreA: true, scoreB: true, winnerTeamId: true },
  })

  const stats = rosters.map((r) => {
    let wins = 0, pf = 0, pa = 0, games = 0
    for (const m of matchups) {
      if (m.teamA !== r.id && m.teamB !== r.id) continue
      games++
      const isA = m.teamA === r.id
      pf += Number(isA ? m.scoreA : m.scoreB) || 0
      pa += Number(isA ? m.scoreB : m.scoreA) || 0
      if (m.winnerTeamId === r.id) wins++
    }
    return {
      rosterId: r.id,
      userId: r.platformUserId ?? '',
      wins,
      losses: Math.max(0, games - wins),
      pointsFor: pf,
      pointsAgainst: pa,
    }
  })

  const matchupData = matchups.map((m) => ({
    teamA: m.teamA,
    teamB: m.teamB,
    winnerTeamId: m.winnerTeamId,
  }))
  if (rosters.length === 0) throw new Error('Championship league has no rosters')
  if (matchups.length === 0) throw new Error('Championship league has no matchup results yet — season may not be complete')

  stats.sort((a, b) => compareByTiebreakers(a, b, ['wins', 'points_for', 'head_to_head'], matchupData))

  const winner = stats[0]
  if (!winner || !winner.userId) throw new Error('Could not determine champion — no valid rosters')

  // Fetch user display info
  const user = await prisma.appUser.findUnique({
    where: { id: winner.userId },
    select: { id: true, displayName: true, username: true },
  })
  const teamName = user?.displayName ?? user?.username ?? winner.userId

  // Mark champion in participant table
  await prisma.legacyTournamentParticipant.updateMany({
    where: { tournamentId, userId: winner.userId },
    data: { status: 'champion', bracketLabel: 'Champion' },
  })

  // Mark all other active participants as finalists (not eliminated — they competed in the final)
  await prisma.legacyTournamentParticipant.updateMany({
    where: {
      tournamentId,
      userId: { not: winner.userId },
      status: 'active',
    },
    data: { status: 'eliminated', eliminatedAtRoundIndex: finalRound.roundIndex },
  })

  // Complete and archive the final round
  await prisma.legacyTournamentRound.updateMany({
    where: { tournamentId, roundIndex: finalRound.roundIndex },
    data: { status: 'completed' },
  })

  // Lock the tournament
  await prisma.legacyTournament.update({
    where: { id: tournamentId },
    data: {
      status: 'completed',
      settings: {
        ...(tournament.settings as Record<string, unknown>),
        championUserId: winner.userId,
        championTeamName: teamName,
        completedAt: new Date().toISOString(),
      },
    },
  })

  // Post champion announcement
  await prisma.legacyTournamentAnnouncement.create({
    data: {
      tournamentId,
      type: 'champion_crowned',
      title: `${teamName} wins ${tournament.name}!`,
      body: JSON.stringify({
        championUserId: winner.userId,
        championTeamName: teamName,
        record: `${winner.wins}-${winner.losses}`,
        pointsFor: winner.pointsFor,
        finalLeagueId: champLeague.leagueId,
        totalRounds: finalRound.roundIndex + 1,
      }),
      pinned: true,
    },
  })

  // Post champion message to championship league chat
  try {
    await createLeagueChatMessage(
      champLeague.leagueId,
      tournament.creatorId,
      `${teamName} is the ${tournament.name} champion! Final record: ${winner.wins}-${winner.losses}, ${winner.pointsFor.toFixed(1)} PF. Congratulations!`,
      {
        type: 'text',
        source: 'tournament_system',
        messageSubtype: 'tournament_champion',
        metadata: { tournamentId, championUserId: winner.userId },
      }
    )
  } catch {
    // Chat posting is non-fatal
  }

  await logTournamentAudit(tournamentId, 'advancement_run', {
    metadata: {
      action: 'crown_champion',
      championUserId: winner.userId,
      championTeamName: teamName,
      finalRoundIndex: finalRound.roundIndex,
    },
  })

  return {
    championUserId: winner.userId,
    championTeamName: teamName,
    tournamentName: tournament.name,
    finalLeagueId: champLeague.leagueId,
    totalRounds: finalRound.roundIndex + 1,
  }
}

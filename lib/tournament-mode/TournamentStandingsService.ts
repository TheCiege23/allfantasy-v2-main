/**
 * [NEW] lib/tournament-mode/TournamentStandingsService.ts
 * Universal standings across all child leagues; qualification seeding.
 * PROMPT 3: Per-conference ranking, tiebreakers (W-L, PF), cut line, bubble status.
 */

import { prisma } from '@/lib/prisma'
import { compareByTiebreakers, getBubbleSlotsPerConference } from './advancement-rules'
import { getQualificationCutSlotsPerConference } from './tournament-sport-cutoffs'

interface UniversalStandingsRow {
  leagueId: string
  leagueName: string | null
  conferenceId: string
  conferenceName: string
  rosterId: string
  userId: string | null
  teamName: string | null
  wins: number
  losses: number
  ties: number
  pointsFor: number
  pointsAgainst: number
  rankInLeague: number
  qualificationRank: number
  /** PROMPT 3: 1-based rank within conference (across all feeder leagues in that conference). */
  rankInConference?: number
  /** PROMPT 3: Would advance by direct cut (before bubble). */
  advancementStatus?: 'advanced' | 'bubble' | 'out'
  /** PROMPT 3: True if in bubble zone (could advance if bubble week enabled). */
  onBubble?: boolean
  /** PROMPT 3: From TournamentParticipant if present. */
  participantStatus?: 'active' | 'eliminated'
  eliminatedAtRoundIndex?: number | null
}

/**
 * Aggregate standings across all leagues in a tournament (qualification round).
 * Uses Roster + MatchupFact; rankInLeague by tiebreakers (wins, pointsFor).
 */
export async function getUniversalStandings(tournamentId: string): Promise<UniversalStandingsRow[]> {
  const rows = await getUniversalStandingsRaw(tournamentId)
  return applyConferenceRankingAndCutLine(tournamentId, rows)
}

/** Raw per-league standings without cross-conference ranking. Used internally. */
export async function getUniversalStandingsRaw(tournamentId: string): Promise<UniversalStandingsRow[]> {
  const leagues = await prisma.legacyTournamentLeague.findMany({
    where: { tournamentId, roundIndex: 0 },
    include: {
      league: { select: { id: true, name: true, leagueSize: true } },
      conference: { select: { id: true, name: true } },
    },
    orderBy: [{ conferenceId: 'asc' }, { orderInConference: 'asc' }],
  })

  const rows: UniversalStandingsRow[] = []
  let qualificationRank = 0

  for (const tl of leagues) {
    const rosters = await prisma.roster.findMany({
      where: { leagueId: tl.leagueId },
      select: { id: true, platformUserId: true },
    })
    const matchups = await prisma.matchupFact.findMany({
      where: { leagueId: tl.leagueId },
      select: { teamA: true, teamB: true, scoreA: true, scoreB: true, winnerTeamId: true },
    })
    const winsMap = new Map<string, number>()
    const pfMap = new Map<string, number>()
    const paMap = new Map<string, number>()
    const gamesMap = new Map<string, number>()
    for (const r of rosters) {
      winsMap.set(r.id, 0)
      pfMap.set(r.id, 0)
      paMap.set(r.id, 0)
      gamesMap.set(r.id, 0)
    }
    for (const m of matchups) {
      const a = m.teamA
      const b = m.teamB
      const scoreA = Number(m.scoreA) || 0
      const scoreB = Number(m.scoreB) || 0
      const winner = m.winnerTeamId
      gamesMap.set(a, (gamesMap.get(a) ?? 0) + 1)
      gamesMap.set(b, (gamesMap.get(b) ?? 0) + 1)
      pfMap.set(a, (pfMap.get(a) ?? 0) + scoreA)
      paMap.set(a, (paMap.get(a) ?? 0) + scoreB)
      pfMap.set(b, (pfMap.get(b) ?? 0) + scoreB)
      paMap.set(b, (paMap.get(b) ?? 0) + scoreA)
      if (winner === a) winsMap.set(a, (winsMap.get(a) ?? 0) + 1)
      else if (winner === b) winsMap.set(b, (winsMap.get(b) ?? 0) + 1)
    }
    const withStats = rosters.map((r) => {
      const wins = winsMap.get(r.id) ?? 0
      const games = gamesMap.get(r.id) ?? 0
      const ties = 0
      const losses = Math.max(0, games - wins - ties)
      return {
        roster: r,
        rosterId: r.id,
        wins,
        losses,
        ties,
        pointsFor: pfMap.get(r.id) ?? 0,
        pointsAgainst: paMap.get(r.id) ?? 0,
      }
    })
    const matchupData = matchups.map((m) => ({
      teamA: m.teamA,
      teamB: m.teamB,
      winnerTeamId: m.winnerTeamId,
    }))
    withStats.sort((a, b) => compareByTiebreakers(a, b, undefined, matchupData))
    withStats.forEach((s, idx) => {
      qualificationRank++
      rows.push({
        leagueId: tl.leagueId,
        leagueName: tl.league.name,
        conferenceId: tl.conference.id,
        conferenceName: tl.conference.name,
        rosterId: s.roster.id,
        userId: s.roster.platformUserId,
        teamName: null,
        wins: s.wins,
        losses: s.losses,
        ties: s.ties,
        pointsFor: s.pointsFor,
        pointsAgainst: s.pointsAgainst,
        rankInLeague: idx + 1,
        qualificationRank,
      })
    })
  }
  return rows
}

/** Apply per-conference ranking, cut line, and bubble status. Optionally merge TournamentParticipant status. */
export async function applyConferenceRankingAndCutLine(
  tournamentId: string,
  rows: UniversalStandingsRow[]
): Promise<UniversalStandingsRow[]> {
  const tournament = await prisma.legacyTournament.findUnique({
    where: { id: tournamentId },
    select: { settings: true, sport: true, conferences: { select: { id: true } } },
  })
  const settings = (tournament?.settings as Record<string, unknown>) ?? {}
  const poolSize = Number(settings.participantPoolSize) || 72
  const bubbleEnabled = Boolean(settings.bubbleWeekEnabled)
  const confCount = tournament?.conferences.length ?? 2
  const advancementPerConf = getQualificationCutSlotsPerConference(
    String(tournament?.sport ?? 'NFL'),
    poolSize,
    typeof settings.qualificationAdvancementTotal === 'number' ? settings.qualificationAdvancementTotal : undefined,
    confCount
  )
  const bubbleSlots = getBubbleSlotsPerConference(advancementPerConf, bubbleEnabled)

  const byConference = new Map<string, UniversalStandingsRow[]>()
  for (const r of rows) {
    const list = byConference.get(r.conferenceId) ?? []
    list.push({ ...r })
    byConference.set(r.conferenceId, list)
  }

  const tiebreakerOrder = (settings.qualificationTiebreakers as string[]) ?? ['wins', 'points_for']

  // Load all matchup facts for H2H tiebreaker support
  const allLeagueIds = [...new Set(rows.map((r) => r.leagueId))]
  const allMatchups = tiebreakerOrder.includes('head_to_head')
    ? await prisma.matchupFact.findMany({
        where: { leagueId: { in: allLeagueIds } },
        select: { teamA: true, teamB: true, winnerTeamId: true },
      })
    : []
  const matchupData = allMatchups.map((m) => ({
    teamA: m.teamA,
    teamB: m.teamB,
    winnerTeamId: m.winnerTeamId,
  }))

  const result: UniversalStandingsRow[] = []
  let qualificationRank = 0

  for (const [, list] of byConference) {
    list.sort((a, b) => compareByTiebreakers(
      { rosterId: a.rosterId, wins: a.wins, losses: a.losses, pointsFor: a.pointsFor, pointsAgainst: a.pointsAgainst },
      { rosterId: b.rosterId, wins: b.wins, losses: b.losses, pointsFor: b.pointsFor, pointsAgainst: b.pointsAgainst },
      tiebreakerOrder,
      matchupData
    ))
    const cutLine = advancementPerConf
    const bubbleStart = cutLine + 1
    const bubbleEnd = cutLine + bubbleSlots
    list.forEach((row, idx) => {
      qualificationRank++
      const rankInConference = idx + 1
      let advancementStatus: 'advanced' | 'bubble' | 'out' = 'out'
      if (rankInConference <= cutLine) advancementStatus = 'advanced'
      else if (bubbleSlots > 0 && rankInConference >= bubbleStart && rankInConference <= bubbleEnd) advancementStatus = 'bubble'
      result.push({
        ...row,
        qualificationRank,
        rankInConference,
        advancementStatus,
        onBubble: advancementStatus === 'bubble',
      })
    })
  }

  result.sort((a, b) => (a.qualificationRank ?? 0) - (b.qualificationRank ?? 0))

  const participants = await prisma.legacyTournamentParticipant.findMany({
    where: { tournamentId },
    select: { userId: true, status: true, eliminatedAtRoundIndex: true },
  })
  const byUser = new Map(participants.map((p) => [p.userId, p]))
  for (const row of result) {
    const p = row.userId ? byUser.get(row.userId) : undefined
    if (p) {
      row.participantStatus = p.status as 'active' | 'eliminated'
      row.eliminatedAtRoundIndex = p.eliminatedAtRoundIndex
    }
  }

  return result
}

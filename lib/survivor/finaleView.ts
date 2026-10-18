import 'server-only'

import { prisma } from '@/lib/prisma'
import { getRosterTeamMap } from '@/lib/zombie/rosterTeamMap'
import { settleFinaleIfDue, type SurvivorFinaleState } from './SurvivorFinaleEngine'
import { getJuryMembers } from './SurvivorJuryEngine'
import { resolveSurvivorCurrentWeek } from './SurvivorTimelineResolver'
import { getSeasonPointsFromRosterPerformance } from './SurvivorVoteEngine'
import { FINALE_TIEBREAK_RULE, juryScoreline, orderFinaleRevealSequence, slipLabel } from './finaleReveal'

export interface FinalistRecord {
  immunityWins: number
  idolsPlayed: number
  seasonPoints: number
  votesSurvived: number
}

export interface FinaleRevealView {
  leagueName: string
  week: number
  finalistCount: 2 | 3
  open: boolean
  /** True until every juror has voted or the deadline passes. No vote data is sent while sealed. */
  sealed: boolean
  votingDeadline: string | null
  juryCount: number
  jury: Array<{ rosterId: string; name: string; votedOutWeek: number }>
  finalists: Array<{ rosterId: string; name: string; record: FinalistRecord }>
  viewer: { rosterId: string | null; isJuror: boolean; isFinalist: boolean; myVoteFinalistRosterId: string | null }
  tiebreakRule: string
  reveal: null | {
    slips: Array<{ index: number; finalistRosterId: string; kind: 'jury' | 'advantage'; label: string }>
    voteCount: Record<string, number>
    winnerRosterId: string
    tieBreakSeasonPoints: Record<string, number> | null
    scoreline: string
  }
  champion: null | { rosterId: string; name: string; scoreline: string; outlasted: number; weeks: number }
}

/**
 * Strip everything a client must not see before the jury vote is complete. Kept separate (and
 * exported) so the secrecy rule is unit-tested without a database.
 */
export function buildFinaleRevealPayload(state: SurvivorFinaleState, finalistOrder: string[]): FinaleRevealView['reveal'] {
  if (!state.votingComplete || !state.winnerRosterId) return null
  const slips = orderFinaleRevealSequence(
    [
      ...Object.entries(state.bonusVotesByFinalist).filter(([, n]) => n > 0).map(([finalistRosterId, n]) => ({ finalistRosterId, weight: n, kind: 'advantage' as const })),
      ...state.votes.map((vote) => ({ finalistRosterId: vote.finalistRosterId, weight: vote.weight, kind: 'jury' as const })),
    ],
    state.winnerRosterId,
    finalistOrder,
  )
  return {
    slips: slips.map((slip) => ({ ...slip, label: slipLabel(slip.index, slip.kind) })),
    voteCount: state.voteCount,
    winnerRosterId: state.winnerRosterId,
    tieBreakSeasonPoints: state.tieBreakSeasonPoints,
    scoreline: juryScoreline(state.voteCount, state.winnerRosterId),
  }
}

async function finalistRecord(leagueId: string, rosterId: string, userId: string | null, week: number): Promise<FinalistRecord> {
  const [immunityWins, idolsPlayed, seasonPoints, votesSurvived] = await Promise.all([
    userId ? prisma.survivorWeeklyScore.count({ where: { leagueId, userId, OR: [{ wonIndividualImmunity: true }, { wonTribeImmunity: true }] } }) : Promise.resolve(0),
    prisma.survivorIdol.count({ where: { leagueId, isUsed: true, OR: [...(userId ? [{ currentOwnerUserId: userId }] : []), { rosterId, currentOwnerUserId: null }] } }),
    getSeasonPointsFromRosterPerformance(leagueId, rosterId, week),
    // Only councils that have closed: a live council's ballots never leave the server.
    prisma.survivorVote.count({ where: { targetRosterId: rosterId, doesNotCount: false, council: { leagueId, closedAt: { not: null } } } }),
  ])
  return { immunityWins, idolsPlayed, seasonPoints: Math.round(seasonPoints * 10) / 10, votesSurvived }
}

export async function getFinaleRevealView(leagueId: string, viewerUserId: string): Promise<FinaleRevealView> {
  const week = await resolveSurvivorCurrentWeek(leagueId)
  // Settles a finale whose deadline passed with ballots missing; otherwise just reads the state.
  const state = await settleFinaleIfDue(leagueId, week)
  const [league, jury, rosters, players, teamMap] = await Promise.all([
    prisma.league.findUnique({ where: { id: leagueId }, select: { name: true } }),
    getJuryMembers(leagueId),
    prisma.roster.findMany({ where: { leagueId }, select: { id: true, platformUserId: true } }),
    prisma.survivorPlayer.findMany({ where: { leagueId }, select: { userId: true, displayName: true } }),
    getRosterTeamMap(leagueId),
  ])
  const teamIds = [...new Set(rosters.map((r) => teamMap.rosterIdToTeamId.get(r.id)).filter((id): id is string => Boolean(id)))]
  const teams = teamIds.length ? await prisma.leagueTeam.findMany({ where: { id: { in: teamIds } }, select: { id: true, teamName: true } }) : []
  const userByRoster = new Map(rosters.map((r) => [r.id, r.platformUserId]))
  const playerName = new Map(players.map((p) => [p.userId, p.displayName]))
  const teamName = new Map(teams.map((t) => [t.id, t.teamName]))
  const nameOf = (rosterId: string) => {
    const userId = userByRoster.get(rosterId)
    const teamId = teamMap.rosterIdToTeamId.get(rosterId)
    return (userId && playerName.get(userId)) || (teamId && teamName.get(teamId)) || 'Manager'
  }
  const viewerRosterId = rosters.find((r) => r.platformUserId === viewerUserId)?.id ?? null
  const finalists = await Promise.all(state.finalists.map(async (rosterId) => ({
    rosterId,
    name: nameOf(rosterId),
    record: await finalistRecord(leagueId, rosterId, userByRoster.get(rosterId) ?? null, week),
  })))
  const reveal = buildFinaleRevealPayload(state, state.finalists)
  const myVote = viewerRosterId ? state.votes.find((vote) => vote.jurorRosterId === viewerRosterId) ?? null : null
  return {
    leagueName: league?.name ?? 'Survivor League',
    week,
    finalistCount: state.finalistCount,
    open: state.open,
    sealed: !reveal,
    votingDeadline: state.votingDeadline?.toISOString() ?? null,
    juryCount: state.juryRosterIds.length,
    jury: jury.map((member) => ({ rosterId: member.rosterId, name: nameOf(member.rosterId), votedOutWeek: member.votedOutWeek })),
    finalists,
    viewer: {
      rosterId: viewerRosterId,
      isJuror: Boolean(viewerRosterId && state.juryRosterIds.includes(viewerRosterId)),
      isFinalist: Boolean(viewerRosterId && state.finalists.includes(viewerRosterId)),
      // A juror sees their own ballot; nobody else's.
      myVoteFinalistRosterId: myVote?.finalistRosterId ?? null,
    },
    tiebreakRule: FINALE_TIEBREAK_RULE,
    reveal,
    champion: reveal ? { rosterId: reveal.winnerRosterId, name: nameOf(reveal.winnerRosterId), scoreline: reveal.scoreline, outlasted: Math.max(0, rosters.length - 1), weeks: week } : null,
  }
}

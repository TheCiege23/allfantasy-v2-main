import 'server-only'

import { prisma } from '@/lib/prisma'
import { buildBallotReveal, type BallotRevealCouncil } from './survivorBallotReveal'
import { readSurvivorFinaleSettings } from './survivorFinaleSettings'

/**
 * Server read of the end-of-season ballot reveal. The season is complete only when the jury has
 * crowned a champion (JurySession.winnerId) — the same moment the finale engine announces it. Before
 * that, and whenever the commissioner has not opted in, this returns null and reads no ballots.
 */
export async function loadEndOfSeasonBallotReveal(leagueId: string): Promise<BallotRevealCouncil[] | null> {
  const [league, session] = await Promise.all([
    prisma.league.findUnique({ where: { id: leagueId }, select: { settings: true } }),
    prisma.jurySession.findUnique({ where: { leagueId }, select: { winnerId: true } }).catch(() => null),
  ])
  const gate = { enabled: readSurvivorFinaleSettings(league?.settings).endOfSeasonBallotReveal, seasonComplete: Boolean(session?.winnerId) }
  if (!gate.enabled || !gate.seasonComplete) return null
  const councils = await prisma.survivorTribalCouncil.findMany({ where: { leagueId }, select: { id: true, week: true, councilNumber: true, phase: true, status: true, isRevealed: true, eliminatedUserId: true } })
  // By council, not by SurvivorVote.leagueId: that column is nullable on older rows.
  const [votes, players] = await Promise.all([
    councils.length ? prisma.survivorVote.findMany({ where: { councilId: { in: councils.map((c) => c.id) } }, select: { councilId: true, voterUserId: true, voterName: true, targetUserId: true, targetName: true, doesNotCount: true, isLateVote: true } }) : Promise.resolve([]),
    prisma.survivorPlayer.findMany({ where: { leagueId }, select: { userId: true, displayName: true } }),
  ])
  return buildBallotReveal(gate, councils, votes, new Map(players.map((p) => [p.userId, p.displayName])))
}

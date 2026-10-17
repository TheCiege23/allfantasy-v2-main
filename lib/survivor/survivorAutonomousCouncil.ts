import 'server-only'

import { createHash } from 'node:crypto'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { loadCouncilContext } from './survivorCouncilService'

type FinalScore = { userId: string; finalScore: number; isFinalized: boolean }

/** Published fallback for planned seasons: lowest verified score, then a reproducible draw. */
export function chooseAutonomousCouncilTarget(councilId: string, candidates: string[], scores: FinalScore[]) {
  const unique = [...new Set(candidates)].sort()
  if (!unique.length) return null
  const byUser = new Map(scores.map(score => [score.userId, score]))
  if (unique.some(userId => !byUser.get(userId)?.isFinalized || !Number.isFinite(byUser.get(userId)?.finalScore))) return null
  const lowest = Math.min(...unique.map(userId => byUser.get(userId)!.finalScore))
  const tied = unique.filter(userId => byUser.get(userId)!.finalScore === lowest)
  const ordered = tied.map(userId => ({ userId, digest: createHash('sha256').update(`${councilId}:${userId}`).digest('hex') }))
    .sort((a, b) => a.digest.localeCompare(b.digest) || a.userId.localeCompare(b.userId))
  return { userId: ordered[0]!.userId, lowestScore: lowest, tiedUserIds: tied, method: tied.length > 1 ? 'lowest_score_seeded_draw' : 'lowest_score' }
}

/** Resolve only a planned council with no valid votes or a tied top vote. Never expose the choice before reveal. */
export async function resolveAutonomousCouncil(leagueId: string, councilId: string) {
  const ctx = await loadCouncilContext(leagueId, councilId)
  if (!ctx) throw new Error('Council missing')
  const council = await prisma.survivorTribalCouncil.findUnique({ where: { id: councilId, leagueId } })
  if (!council || council.isRevealed || council.eliminatedUserId) return
  if (!['closed', 'tie_pending'].includes(council.status)) throw new Error('Council is not tallied')
  const protectedRosters = new Set(ctx.council.idolsPlayed.filter(play => play.powerType === 'vote_shield').map(play => play.protectedRosterId ?? play.playerRosterId))
  // A tied tally must reach the revote path; autonomous fallback applies only when nobody
  // cast a valid ballot. It must never erase a tied public result before its first read.
  if (council.isTie || council.phase === 'revote') return
  const candidates = ctx.eligibility.targetUserIds
  const eligible = candidates.filter(userId => !protectedRosters.has(ctx.userToRoster[userId] ?? ''))
  if (!eligible.length || eligible.some(userId => !ctx.userToRoster[userId])) throw new Error('No verified eligible council target')
  const game = await prisma.survivorGameState.findUnique({ where: { leagueId }, select: { immunePlayerId: true } })
  const scores = await prisma.survivorWeeklyScore.findMany({ where: { leagueId, week: council.week, userId: { in: eligible } }, select: { userId: true, finalScore: true, isFinalized: true, wonIndividualImmunity: true } })
  const immune = new Set(scores.filter(score => score.wonIndividualImmunity).map(score => score.userId))
  if (game?.immunePlayerId) immune.add(game.immunePlayerId)
  const choice = chooseAutonomousCouncilTarget(councilId, eligible.filter(userId => !immune.has(userId)), scores)
  if (!choice) throw new Error('Autonomous council needs finalized scores for every eligible target')
  const player = ctx.scopePlayers.find(item => item.userId === choice.userId)!
  await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`survivor-setup:${leagueId}`}, 0))::text`
    const current = await tx.survivorTribalCouncil.findUnique({ where: { id: councilId, leagueId } })
    if (!current || current.isRevealed || current.eliminatedUserId) return
    await tx.survivorTribalCouncil.update({ where: { id: councilId }, data: {
      eliminatedUserId: choice.userId, eliminatedRosterId: player.rosterId, eliminatedName: player.displayName,
      isTie: false, status: 'closed', tiePhase: 'system_score_fallback',
      tieBreakSeasonPoints: { rule: choice.method, week: council.week, lowestScore: choice.lowestScore, tiedUserIds: choice.tiedUserIds } as Prisma.InputJsonValue,
      revealSequence: Array.isArray(current.revealSequence) ? current.revealSequence : [],
    } })
    await tx.survivorAuditEntry.create({ data: { leagueId, week: council.week, category: 'tribal', action: 'system_council_fallback', relatedEntityId: councilId, relatedEntityType: 'council', data: { rule: choice.method, candidateCount: eligible.length }, isVisibleToCommissioner: false, isVisibleToPublic: false } })
  })
}

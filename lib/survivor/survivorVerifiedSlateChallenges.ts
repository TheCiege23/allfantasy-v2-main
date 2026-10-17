import 'server-only'

import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'

type Score = { userId: string; tribeId: string | null; finalScore: number; isFinalized: boolean; countedTowardTribeTotal: boolean }

export function verifiedSlateWinners(scores: Score[]) {
  if (!scores.length || scores.some(score => !score.isFinalized || !Number.isFinite(score.finalScore))) return null
  const individual = [...scores].sort((a, b) => b.finalScore - a.finalScore || a.userId.localeCompare(b.userId))[0]!
  const tribes = new Map<string, number>()
  for (const score of scores) if (score.tribeId && score.countedTowardTribeTotal) tribes.set(score.tribeId, (tribes.get(score.tribeId) ?? 0) + score.finalScore)
  const tribe = [...tribes].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0] ?? null
  return { individualUserId: individual.userId, individualPoints: individual.finalScore, tribeId: tribe?.[0] ?? null, tribePoints: tribe?.[1] ?? null }
}

/** NBA/NHL weekly slate contests use verified native scoring, never an AI-generated answer key. */
export async function ensureVerifiedSlateChallenges(leagueId: string, week: number, sport: 'NBA' | 'NHL', includeTribe: boolean) {
  const config = await prisma.survivorLeagueConfig.findUnique({ where: { leagueId }, select: { id: true } })
  if (!config) throw new Error('Survivor configuration missing')
  for (const [number, scope] of [[1, 'tribe'], [2, 'individual']] as const) {
    if (scope === 'tribe' && !includeTribe) continue
    await prisma.survivorChallenge.upsert({
      where: { configId_week_challengeNumber_challengeType: { configId: config.id, week, challengeNumber: number, challengeType: 'verified_weekly_slate' } },
      create: { leagueId, configId: config.id, week, challengeNumber: number, challengeType: 'verified_weekly_slate', scope,
        title: `${sport} weekly ${scope === 'tribe' ? 'tribe' : 'individual'} slate`,
        description: `Finalized ${sport} fantasy points decide this weekly ${scope} contest.`,
        instructions: 'Set your legal lineup. Chimmy settles this challenge when every roster score is final.',
        submissionMode: 'automatic', status: 'open', configJson: { sport, source: 'native_finalized_weekly_scores_v1' } },
      update: {},
    })
  }
}

export async function settleVerifiedSlateChallenges(leagueId: string, week: number) {
  const challenges = await prisma.survivorChallenge.findMany({ where: { leagueId, week, challengeType: 'verified_weekly_slate' } })
  if (!challenges.some(challenge => challenge.scope === 'individual')) throw new Error('Weekly individual slate challenge missing')
  const active = await prisma.survivorPlayer.findMany({ where: { leagueId, playerState: 'active' }, select: { userId: true } })
  const scores = await prisma.survivorWeeklyScore.findMany({ where: { leagueId, week, userId: { in: active.map(player => player.userId) } }, select: { userId: true, tribeId: true, finalScore: true, isFinalized: true, countedTowardTribeTotal: true } })
  if (scores.length !== active.length) throw new Error('Weekly slate scores incomplete')
  const winners = verifiedSlateWinners(scores)
  if (!winners) throw new Error('Weekly slate scores are not finalized')
  if (challenges.some(challenge => challenge.scope === 'tribe') && !winners.tribeId) throw new Error('Tribe slate has no eligible scored tribe')
  const now = new Date()
  await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`survivor-setup:${leagueId}`}, 0))::text`
    for (const challenge of challenges) {
      const latest = await tx.survivorChallenge.findUnique({ where: { id: challenge.id } })
      if (latest?.status === 'complete') continue
      const isTribe = challenge.scope === 'tribe'
      await tx.survivorChallenge.update({ where: { id: challenge.id }, data: { status: 'complete', lockAt: now, closesAt: now,
        winnerTribeId: isTribe ? winners.tribeId : null, winnerUserIds: isTribe ? [] : [winners.individualUserId],
        resultJson: { source: 'native_finalized_weekly_scores_v1', score: isTribe ? winners.tribePoints : winners.individualPoints, settledAt: now.toISOString() } as Prisma.InputJsonValue,
        resultSummary: isTribe ? `Tribe ${winners.tribeId} wins the ${week} slate.` : `The weekly individual winner is ${winners.individualUserId}.`,
      } })
      await tx.survivorAuditEntry.create({ data: { leagueId, week, category: 'challenge', action: 'verified_slate_result', relatedEntityId: challenge.id, relatedEntityType: 'challenge', data: { scope: challenge.scope, winnerTribeId: isTribe ? winners.tribeId : null, winnerUserId: isTribe ? null : winners.individualUserId }, isVisibleToCommissioner: true, isVisibleToPublic: true } })
    }
  })
}

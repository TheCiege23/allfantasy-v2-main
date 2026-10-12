/**
 * Weekly Recap Generator — compiles week summary and posts to league chat.
 * Called by the automation cron after scoring finalizes and tribal completes.
 */

import { prisma } from '@/lib/prisma'
import { postWeeklyRecap } from './leagueChatPoster'
import { logAuditEntry } from './auditFramework'

export async function generateAndPostWeeklyRecap(
  leagueId: string,
  week: number,
): Promise<void> {
  // Get week's challenge
  const challenge = await (prisma as any).survivorChallenge.findFirst({
    where: { leagueId, week },
    select: { title: true, winnerTribeId: true, winnerUserIds: true },
  })

  // Get elimination council result
  const council = await (prisma as any).survivorTribalCouncil.findFirst({
    where: { leagueId, week, status: 'completed' },
    select: { eliminatedName: true, attendingTribeId: true, idolsPlayed: true, isTie: true },
  })

  // Get top scorer
  const topScore = await (prisma as any).survivorWeeklyScore.findFirst({
    where: { leagueId, week, isFinalized: true },
    orderBy: { finalScore: 'desc' },
    select: { userId: true, finalScore: true },
  })

  let topScorerName: string | undefined
  if (topScore) {
    const p = await (prisma as any).survivorPlayer.findFirst({
      where: { leagueId, userId: topScore.userId },
      select: { displayName: true },
    })
    topScorerName = p?.displayName ?? topScore.userId
  }

  // Get immunity holder
  const immunePlayer = await (prisma as any).survivorPlayer.findFirst({
    where: { leagueId, hasImmunityThisWeek: true },
    select: { displayName: true },
  })

  // Get winning tribe name
  let challengeWinner: string | undefined
  if (challenge?.winnerTribeId) {
    const tribe = await (prisma as any).survivorTribe.findUnique({
      where: { id: challenge.winnerTribeId },
      select: { name: true },
    })
    challengeWinner = tribe?.name
  }

  // Get attending tribe name
  let tribalLoser: string | undefined
  if (council?.attendingTribeId) {
    const tribe = await (prisma as any).survivorTribe.findUnique({
      where: { id: council.attendingTribeId },
      select: { name: true },
    })
    tribalLoser = tribe?.name
  }

  // Get twist
  const twist = await (prisma as any).survivorTwistEvent.findFirst({
    where: { leagueId, week },
    select: { description: true },
  })

  // Compile idol plays
  const idolsPlayed = council?.idolsPlayed
    ? (council.idolsPlayed as Array<{ powerLabel?: string }>).map((i) => i.powerLabel ?? 'Hidden Power')
    : []

  const recap = {
    challengeWinner,
    tribalLoser,
    eliminatedPlayer: council?.eliminatedName,
    immunityHolder: immunePlayer?.displayName,
    idolsPlayed: idolsPlayed.length > 0 ? idolsPlayed : undefined,
    twistSummary: twist?.description,
    topScorer: topScorerName,
    topScore: topScore?.finalScore,
  }

  await postWeeklyRecap(leagueId, week, recap)

  // Also save to episode summaries table
  await (prisma as any).survivorEpisodeSummary?.upsert?.({
    where: { uniq_league_week: { leagueId, week } },
    create: {
      leagueId,
      week,
      title: `Week ${week}`,
      challengeTitle: challenge?.title,
      winningTribeOrPlayer: challengeWinner,
      losingTribeOrPlayer: tribalLoser,
      votedOutPlayer: council?.eliminatedName,
      idolsPlayed: idolsPlayed,
      twistDescription: twist?.description,
      isFinalized: true,
    },
    update: {
      challengeTitle: challenge?.title,
      winningTribeOrPlayer: challengeWinner,
      losingTribeOrPlayer: tribalLoser,
      votedOutPlayer: council?.eliminatedName,
      idolsPlayed: idolsPlayed,
      twistDescription: twist?.description,
      isFinalized: true,
    },
  }).catch(() => {})

  await logAuditEntry({
    leagueId,
    week,
    category: 'automation',
    action: 'week_finalized',
    data: { recap },
  })
}

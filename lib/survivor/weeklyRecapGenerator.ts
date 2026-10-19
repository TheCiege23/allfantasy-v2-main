/**
 * Weekly Recap Generator — compiles week summary and posts to league chat.
 * Called by the automation cron after scoring finalizes and tribal completes.
 */

import { prisma } from '@/lib/prisma'
import { postWeeklyRecap } from './leagueChatPoster'
import { isCouncilReadComplete } from './survivorRevealGate'

export async function generateAndPostWeeklyRecap(
  leagueId: string,
  week: number,
): Promise<void> {
  // Get week's challenge
  const challenge = await prisma.survivorChallenge.findFirst({
    where: { leagueId, week, scope: 'tribe', status: 'complete' },
    select: { title: true, winnerTribeId: true, winnerUserIds: true },
  })

  // Get elimination council result
  const found = await prisma.survivorTribalCouncil.findFirst({
    where: { leagueId, week, isRevealed: true, eliminatedRosterId: { not: null } },
    select: { eliminatedName: true, attendingTribeId: true, idolsPlayed: true, isTie: true, isRevealed: true, revealStartsAt: true, revealStep: true, revealSequence: true },
  })
  // A recap never names a voted-out manager before the council read has finished.
  const league = found ? await prisma.league.findUnique({ where: { id: leagueId }, select: { survivorRevealMode: true } }) : null
  const council = found && isCouncilReadComplete(found, league?.survivorRevealMode) ? found : null

  // Get top scorer
  const topScore = await prisma.survivorWeeklyScore.findFirst({
    where: { leagueId, week, isFinalized: true },
    orderBy: { finalScore: 'desc' },
    select: { userId: true, finalScore: true },
  })

  let topScorerName: string | undefined
  if (topScore) {
    const p = await prisma.survivorPlayer.findFirst({
      where: { leagueId, userId: topScore.userId },
      select: { displayName: true },
    })
    topScorerName = p?.displayName ?? topScore.userId
  }

  // Get immunity holder
  const immunePlayer = await prisma.survivorPlayer.findFirst({
    where: { leagueId, hasImmunityThisWeek: true },
    select: { displayName: true },
  })

  // Get winning tribe name
  let challengeWinner: string | undefined
  if (challenge?.winnerTribeId) {
    const tribe = await prisma.survivorTribe.findUnique({
      where: { id: challenge.winnerTribeId },
      select: { name: true },
    })
    challengeWinner = tribe?.name
  }

  // Get attending tribe name
  let tribalLoser: string | undefined
  if (council?.attendingTribeId) {
    const tribe = await prisma.survivorTribe.findUnique({
      where: { id: council.attendingTribeId },
      select: { name: true },
    })
    tribalLoser = tribe?.name
  }

  // Get twist
  const twist = await prisma.survivorTwistEvent.findFirst({
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
    eliminatedPlayer: council?.eliminatedName ?? undefined,
    immunityHolder: immunePlayer?.displayName,
    idolsPlayed: idolsPlayed.length > 0 ? idolsPlayed : undefined,
    twistSummary: twist?.description,
    topScorer: topScorerName,
    topScore: topScore?.finalScore,
  }

  await postWeeklyRecap(leagueId, week, recap)

  await prisma.survivorAuditEntry.upsert({
    where: { id: `survivor-weekly-recap-audit:${leagueId}:${week}` },
    create: {
      id: `survivor-weekly-recap-audit:${leagueId}:${week}`,
      leagueId,
      week,
      category: 'automation',
      action: 'weekly_recap_posted',
      data: { posted: true },
      isVisibleToCommissioner: true,
      isVisibleToPublic: true,
    },
    update: {},
  })
}

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

  // Every council that sent someone home this week, in order: a double-elimination week has two.
  const found = await prisma.survivorTribalCouncil.findMany({
    where: { leagueId, week, isRevealed: true, eliminatedRosterId: { not: null } },
    orderBy: { councilNumber: 'asc' },
    select: { eliminatedName: true, attendingTribeId: true, idolsPlayed: true, isTie: true, isRevealed: true, revealStartsAt: true, revealStep: true, revealSequence: true },
  })
  // A recap never names a voted-out manager before the council read has finished.
  const league = found.length ? await prisma.league.findUnique({ where: { id: leagueId }, select: { survivorRevealMode: true } }) : null
  const councils = found.filter(row => isCouncilReadComplete(row, league?.survivorRevealMode))

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

  // Attending tribe names, once each (both councils of a week can be the same tribe)
  const attendingTribeIds = [...new Set(councils.map(c => c.attendingTribeId).filter((id): id is string => Boolean(id)))]
  const attendingTribes = attendingTribeIds.length
    ? await prisma.survivorTribe.findMany({ where: { id: { in: attendingTribeIds } }, select: { id: true, name: true } })
    : []
  const tribalLoser = joinNames(attendingTribeIds.map(id => attendingTribes.find(t => t.id === id)?.name).filter((n): n is string => Boolean(n)))

  // Get twist
  const twist = await prisma.survivorTwistEvent.findFirst({
    where: { leagueId, week },
    select: { description: true },
  })

  // Compile idol plays
  const idolsPlayed = councils.flatMap(c => Array.isArray(c.idolsPlayed)
    ? (c.idolsPlayed as Array<{ powerLabel?: string }>).map((i) => i.powerLabel ?? 'Hidden Power')
    : [])

  const recap = {
    challengeWinner,
    tribalLoser,
    eliminatedPlayer: joinNames(councils.map(c => c.eliminatedName).filter((n): n is string => Boolean(n))),
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

/** "A", "A and B": a double-elimination week names both. */
function joinNames(names: string[]): string | undefined {
  if (names.length === 0) return undefined
  return names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}

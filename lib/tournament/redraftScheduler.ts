import { prisma } from '@/lib/prisma'
import {
  calculateConferenceStandings,
  calculateLeagueStandings,
  executeAdvancement,
  identifyQualifiers,
} from '@/lib/tournament/advancementEngine'
import { openBubblePhase, resolveBubble } from '@/lib/tournament/bubbleEngine'

export { scheduleRoundDraft } from '@/lib/tournament/scheduleRoundDraft'
export { applyRoundRosterRules } from '@/lib/tournament/rosterRules'

export async function handleRoundTransition(
  tournamentId: string,
  completedRoundNumber: number,
): Promise<void> {
  const shell = await prisma.tournamentShell.findUnique({
    where: { id: tournamentId },
    include: { rounds: { orderBy: { roundNumber: 'asc' } } },
  })
  if (!shell) throw new Error('Tournament not found')

  const completed = shell.rounds.find((r) => r.roundNumber === completedRoundNumber)
  if (!completed) throw new Error('Round not found')

  const openingRound = shell.rounds.find((r) => r.roundNumber === 1)
  const standingsRoundId =
    completed.roundType === 'bubble' && openingRound ? openingRound.id : completed.id

  const tls = await prisma.tournamentLeague.findMany({
    where: { tournamentId, roundId: standingsRoundId },
  })
  for (const tl of tls) {
    if (tl.leagueId) {
      await calculateLeagueStandings(tl.id)
    }
  }

  const conferences = await prisma.tournamentConference.findMany({ where: { tournamentId } })
  for (const c of conferences) {
    await calculateConferenceStandings(c.id, standingsRoundId)
  }

  if (completed.roundType === 'opening') {
    await identifyQualifiers(tournamentId, completed.id)
    if (shell.bubbleEnabled) {
      await openBubblePhase(tournamentId, completed.id)
      const bubbleRound = shell.rounds.find((r) => r.roundType === 'bubble')
      await prisma.tournamentShell.update({
        where: { id: tournamentId },
        data: {
          status: 'bubble',
          currentRoundNumber: bubbleRound?.roundNumber ?? completed.roundNumber + 1,
        },
      })
    } else {
      await executeAdvancement(tournamentId, completed.roundNumber)
    }
  } else if (completed.roundType === 'bubble') {
    await resolveBubble(tournamentId)
  } else {
    await identifyQualifiers(tournamentId, completed.id)
    await executeAdvancement(tournamentId, completed.roundNumber)
  }

  await prisma.tournamentRound.update({
    where: { id: completed.id },
    data: { status: 'complete', roundCompletedAt: new Date() },
  })

  await prisma.tournamentAnnouncement.create({
    data: {
      tournamentId,
      roundNumber: completedRoundNumber,
      type: 'round_summary',
      title: `Round ${completedRoundNumber} complete`,
      content: 'Standings synced and advancement rules evaluated.',
      targetAudience: 'all',
    },
  })
}

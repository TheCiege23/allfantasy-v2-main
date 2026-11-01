import 'server-only'

import { prisma } from '@/lib/prisma'
import { voidPendingRedraftTradesForRoster } from '@/lib/redraft/voidPendingTradesForElimination'
import { enqueueNotification } from './notificationEngine'
import { maybeTriggerSurvivorTribeShuffleRecommendation } from './SurvivorSitOutEngine'

/**
 * The commissioner's "remove a manager" action, shared by the Hub's Fix-a-problem card
 * (`remove_player` in app/api/survivor/commissioner/route.ts) and the conduct-strike limit
 * (survivorConductService.ts). Moved here unchanged so both paths remove a manager the same way:
 * their open-council ballots cleared, their idols expired, their pending trades voided, the player
 * marked eliminated, the action logged, a tribe-imbalance check and a spoiler-safe notice.
 */
export async function removeSurvivorPlayer(
  leagueId: string,
  input: { targetUserId: string; commissionerId: string; reason: string; actionType?: string },
): Promise<void> {
  const { targetUserId, commissionerId, reason } = input

  // Clear only the ballots this manager cast or received. Everyone else's stand; anyone whose vote
  // named them can vote again before the deadline.
  const openCouncil = await prisma.survivorTribalCouncil.findFirst({
    where: { leagueId, status: 'voting_open' },
    select: { id: true },
  })
  if (openCouncil) {
    await prisma.survivorVote.deleteMany({ where: { councilId: openCouncil.id, OR: [{ voterUserId: targetUserId }, { targetUserId }] } })
  }

  await prisma.survivorIdol.updateMany({
    where: { leagueId, currentOwnerUserId: targetUserId, isUsed: false },
    data: { status: 'expired', expiredAt: new Date() },
  })

  const r0 = await prisma.roster.findFirst({
    where: { leagueId, platformUserId: targetUserId },
    select: { id: true },
  })
  if (r0) {
    // The commissioner removing them is never told about their own action.
    await voidPendingRedraftTradesForRoster(leagueId, r0.id, { actorUserId: commissionerId }).catch(() => {})
  }

  await prisma.survivorPlayer.updateMany({
    where: { leagueId, userId: targetUserId },
    data: { playerState: 'eliminated' },
  })

  await prisma.survivorCommissionerAction.create({
    data: {
      leagueId,
      commissionerId,
      actionType: input.actionType ?? 'remove_player',
      description: reason,
      targetUserId,
      newState: { playerState: 'eliminated' } as object,
    },
  })
  // A quit can leave a tribe short, exactly like a vote-out: raise the same redraw recommendation.
  const removedWeek = (await prisma.survivorGameState.findUnique({ where: { leagueId }, select: { currentWeek: true } }))?.currentWeek
  if (removedWeek) await maybeTriggerSurvivorTribeShuffleRecommendation(leagueId, removedWeek).catch(() => {})

  await enqueueNotification(leagueId, 'phase_change', {
    recipientRole: 'all',
    title: 'League update',
    body: 'A player has been removed from the season.',
    isSpoilerSafe: true,
    urgency: 'high',
  })
}

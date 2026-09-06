import { prisma } from '@/lib/prisma'
import { computeKeeperEligibility } from './eligibilityEngine'
import { openKeeperSelectionPhase } from './selectionEngine'
import { checkAndTriggerRatingIfOffseason } from '@/lib/commissioner/CommissionerRatingTrigger'
import { ensureNextRedraftSeasonShell } from '@/lib/redraft/offseason/ensureNextRedraftSeasonShell'

export async function triggerKeeperOffseason(
  leagueId: string,
  completedSeasonId: string,
): Promise<void> {
  await prisma.redraftSeason.updateMany({
    where: { id: completedSeasonId, leagueId },
    data: { status: 'complete' },
  })

  await prisma.league.update({
    where: { id: leagueId },
    data: { dynastySeasonPhase: 'offseason' },
  })

  await computeKeeperEligibility(leagueId, completedSeasonId)

  // Trigger commissioner rating prompt in league chat
  await checkAndTriggerRatingIfOffseason(leagueId).catch(() => {})

  // Previously bailed here if no incoming season existed yet, which was the
  // silent dead end: nothing else in the app ever created one, so the keeper
  // window never opened and locked selections had nowhere to carry over to.
  const incoming = await ensureNextRedraftSeasonShell(leagueId, completedSeasonId)
  if (!incoming) return

  const deadline = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
  await openKeeperSelectionPhase(leagueId, incoming.id, deadline)
}

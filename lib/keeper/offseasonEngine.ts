import { prisma } from '@/lib/prisma'
import { computeKeeperEligibility } from './eligibilityEngine'
import { openKeeperSelectionPhase } from './selectionEngine'
import { checkAndTriggerRatingIfOffseason } from '@/lib/commissioner/CommissionerRatingTrigger'
import { ensureNextRedraftSeasonShell } from '@/lib/redraft/offseason/ensureNextRedraftSeasonShell'
import { carryDynastyRostersForward, isDynastyFamilyLeague } from '@/lib/redraft/offseason/carryDynastyRosters'

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

  // A dynasty league keeps everyone: carry the whole roster, and open no keeper window — a
  // keeper cap there would silently release most of every team back into the pool.
  const format = await prisma.league.findUnique({
    where: { id: leagueId },
    select: { leagueType: true, isDynasty: true },
  })
  if (format && isDynastyFamilyLeague(format)) {
    await carryDynastyRostersForward(leagueId, completedSeasonId, incoming.id)
    return
  }

  const deadline = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
  await openKeeperSelectionPhase(leagueId, incoming.id, deadline)
}

import { prisma } from '@/lib/prisma'
import { getRosterPlayerIds } from '@/lib/waiver-wire/roster-utils'
import { releaseChoppedRosters } from './GuillotineRosterReleaseEngine'

/** Resume a release that failed after the chop audit committed. Never select another chop. */
export async function resumeAuditedRosterRelease(leagueId: string, seasonId: string, scoringPeriod: number): Promise<void> {
  const audit = await prisma.guillotineElimination.findMany({
    where: { leagueId, seasonId, scoringPeriod }, select: { eliminatedRosterId: true },
  })
  const redraftIds = audit.map(row => row.eliminatedRosterId)
  if (!redraftIds.length) return
  const rosters = await prisma.roster.findMany({
    where: { leagueId, redraftRosterId: { in: redraftIds } }, select: { id: true, playerData: true },
  })
  const pending = rosters.filter(row => getRosterPlayerIds(row.playerData).length > 0).map(row => row.id)
  if (pending.length) await releaseChoppedRosters({ leagueId, rosterIds: pending, releaseTiming: 'immediate' })
  await prisma.redraftRosterPlayer.updateMany({ where: { rosterId: { in: redraftIds }, droppedAt: null }, data: { droppedAt: new Date() } })
}

import 'server-only'

/** The facts `myTeamAutomations` (./myTeamAutomations.ts) needs, for the signed-in manager's own team. */
import { prisma } from '@/lib/prisma'
import { readManagedLineups, managedForOwner } from '@/lib/inactive-manager/inactiveManagerMode'
import { ownerHasAfCommissionerPlan } from '@/lib/stat-corrections/applyStatCorrections'
import { autoBenchByeLeagueBlock } from './autoBenchByeService'
import { myTeamAutomations, type MyTeamAutomation } from './myTeamAutomations'

export type MyTeamAutomationsView = { available: true; items: MyTeamAutomation[]; takeBack: MyTeamAutomation } | { available: false; reason: string }

export async function readMyTeamAutomations(leagueId: string, userId: string): Promise<MyTeamAutomationsView> {
  const [league, roster] = await Promise.all([
    prisma.league.findUnique({ where: { id: leagueId }, select: { userId: true, platform: true, sport: true, settings: true, leagueType: true, bestBallMode: true } }),
    prisma.roster.findFirst({ where: { leagueId, platformUserId: userId }, select: { id: true } }),
  ])
  if (!league || !roster) return { available: false, reason: 'no_team' }
  const block = autoBenchByeLeagueBlock(league)
  // An imported league runs on its host: AllFantasy acts on no one's team there.
  if (block === 'not_native') return { available: false, reason: block }
  const entry = readManagedLineups(league.settings)[roster.id]
  const managed = entry && managedForOwner(entry, userId) !== 'new_owner' ? { autopilot: Boolean(entry.autopilot) } : null
  const view = myTeamAutomations({
    settings: league.settings,
    weeklyLineups: block === null,
    commissionerPlan: await ownerHasAfCommissionerPlan(league.userId),
    managed,
  })
  return { available: true, ...view }
}

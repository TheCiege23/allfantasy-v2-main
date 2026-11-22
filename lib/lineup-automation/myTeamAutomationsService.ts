import { resolveViewingRoster } from '@/lib/league/viewerTeams'
import 'server-only'

/** The facts `myTeamAutomations` (./myTeamAutomations.ts) needs, for the signed-in manager's own team. */
import { prisma } from '@/lib/prisma'
import { readManagedLineups, managedForOwner } from '@/lib/inactive-manager/inactiveManagerMode'
import { ownerHasAfCommissionerPlan } from '@/lib/stat-corrections/applyStatCorrections'
import { autopilotEntitled } from '@/lib/inactive-manager/inactiveManagerService'
import { autoBenchByeLeagueBlock } from './autoBenchByeService'
import { autoSwitchInjuredFor } from './autoSwitchInjured'
import { ownerHasAutoSwitchPlan } from './autoSwitchInjuredService'
import { myTeamAutomations, type MyTeamAutomation } from './myTeamAutomations'

export type MyTeamAutomationsView = { available: true; items: MyTeamAutomation[]; takeBack: MyTeamAutomation } | { available: false; reason: string }

export async function readMyTeamAutomations(leagueId: string, userId: string, rosterId?: string | null): Promise<MyTeamAutomationsView> {
  const [league, viewing] = await Promise.all([
    prisma.league.findUnique({ where: { id: leagueId }, select: { userId: true, platform: true, sport: true, settings: true, leagueType: true, bestBallMode: true } }),
    // With several teams: the named one when it is theirs, else their first (lib/league/viewerTeams.ts).
    resolveViewingRoster(leagueId, userId, rosterId, { allowCoOwner: false }),
  ])
  const roster = viewing
    ? await prisma.roster.findFirst({ where: { id: viewing.rosterId, leagueId }, select: { id: true, settings: true, platformUserId: true } })
    : null
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
    autopilotPlan: await autopilotEntitled(league.userId),
    managed,
    autoSwitch: await (async () => {
      const s = autoSwitchInjuredFor(roster.settings, roster.platformUserId)
      return s && (await ownerHasAutoSwitchPlan(userId)) ? { level: s.level, timing: s.timing } : null
    })(),
  })
  return { available: true, ...view }
}

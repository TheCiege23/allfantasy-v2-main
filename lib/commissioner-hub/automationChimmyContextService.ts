import 'server-only'

/** Reads what `automationContextForChimmy` (./automationChimmyContext.ts) needs, for one asker in one league. */
import { prisma } from '@/lib/prisma'
import { getLeagueRole } from '@/lib/league/permissions'
import { readMyTeamAutomations } from '@/lib/lineup-automation/myTeamAutomationsService'
import { readAutomationFacts } from './automationOverviewService'
import { buildAutomationOverview } from './automationOverview'
import { automationContextForChimmy, type RecentAutomaticChange } from './automationChimmyContext'

const RECENT_DAYS = 14
const RECENT_MAX = 10

/** Mode changes on a team recorded in the league audit log, worded for a manager. */
const MODE_MESSAGES: Record<string, string> = {
  'inactive_manager_mode.on': 'The commissioner handed the team to AllFantasy to set its lineups.',
  'inactive_manager_mode.auto_handover': 'The team had no activity for the commissioner’s chosen number of days, so AllFantasy took it over.',
  'inactive_manager_mode.ended': 'The owner saved a lineup, so AllFantasy stopped running the team.',
  'inactive_manager_mode.ended_new_owner': 'The team changed hands, so AllFantasy stopped running it for the previous owner.',
  'chimmy_autopilot.on': 'The commissioner put the team on Chimmy autopilot.',
  'chimmy_autopilot.claim': 'Chimmy made a waiver claim for the team on autopilot.',
}

export async function buildAutomationContextForChimmy(leagueId: string, userId: string, now = new Date()): Promise<string> {
  const read = await readAutomationFacts(leagueId)
  if (!read || !read.native) return ''
  const [role, myTeam, roster] = await Promise.all([
    getLeagueRole(leagueId, userId).catch(() => null),
    readMyTeamAutomations(leagueId, userId).catch(() => null),
    prisma.roster.findFirst({ where: { leagueId, platformUserId: userId }, select: { id: true } }),
  ])
  const commissioner = role === 'commissioner' || role === 'co_commissioner'
  let recent: RecentAutomaticChange[] = []
  if (roster) {
    const since = new Date(now.getTime() - RECENT_DAYS * 86_400_000)
    const [automated, modes] = await Promise.all([
      prisma.automationAuditLog.findMany({
        where: { leagueId, entityType: 'roster', entityId: roster.id, createdAt: { gte: since } },
        orderBy: { createdAt: 'desc' },
        take: RECENT_MAX,
        select: { createdAt: true, message: true },
      }),
      prisma.leagueAuditLog.findMany({
        where: { leagueId, entityType: 'roster', entityId: roster.id, actionType: { in: Object.keys(MODE_MESSAGES) }, createdAt: { gte: since } },
        orderBy: { createdAt: 'desc' },
        take: RECENT_MAX,
        select: { createdAt: true, actionType: true },
      }),
    ])
    recent = [
      ...automated.map((r) => ({ at: r.createdAt, message: r.message })),
      ...modes.map((r) => ({ at: r.createdAt, message: MODE_MESSAGES[r.actionType]! })),
    ]
      .sort((a, b) => b.at.getTime() - a.at.getTime())
      .slice(0, RECENT_MAX)
  }
  return automationContextForChimmy({
    myTeam: myTeam?.available ? { items: myTeam.items, takeBack: myTeam.takeBack } : null,
    commissionerRows: commissioner ? buildAutomationOverview(read.facts) : null,
    recent,
  })
}

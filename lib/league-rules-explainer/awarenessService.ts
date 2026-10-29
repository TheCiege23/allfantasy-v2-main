import 'server-only'

/**
 * Reads for ./awareness.ts: the league's change cards, members' seen markers, and the roster of
 * managers. Database only; nothing here calls a provider.
 */

import { prisma } from '@/lib/prisma'
import { isLeaguePrefEnabled, parseLeagueNotificationPrefs } from '@/lib/league/league-notification-prefs'
import type { WorkspaceTaskCandidate } from '@/lib/commissioner-workspace/taskSources'
import { groupSettingsChanges } from './explain'
import { loadSettingsChangeEvents } from './load'
import { isRulesExplainerLeague, rulesSportOf } from './snapshot'
import { getLeagueRulesSeen, getLeagueRulesSeenForUsers } from './seenStore'
import { detectUnseenRuleChange, ruleChangesForChimmy } from './awareness'
import type { ChangeGroup, SettingsChangeEvent } from './types'

const SELECT = {
  userId: true,
  platform: true,
  sport: true,
  leagueType: true,
  leagueVariant: true,
  guillotineMode: true,
  isDynasty: true,
  bestBallMode: true,
  survivorMode: true,
  settings: true,
} as const

type Row = { userId: string; settings: unknown; sport: unknown } & Parameters<typeof isRulesExplainerLeague>[0]

async function loadChanges(leagueId: string): Promise<{ league: Row; events: SettingsChangeEvent[]; groups: ChangeGroup[] } | null> {
  const league = (await prisma.league.findUnique({ where: { id: leagueId }, select: SELECT })) as Row | null
  // Imported leagues have no change history here: their rules change on their platform.
  if (!league || !isRulesExplainerLeague(league)) return null
  const events = await loadSettingsChangeEvents(leagueId)
  return { league, events, groups: groupSettingsChanges(events, { sport: rulesSportOf(league.sport) }) }
}

/** For the Chimmy route's league context. Empty when the league has no explainable changes. */
export async function buildRuleChangesContextForChimmy(leagueId: string, userId: string, now = new Date()): Promise<string> {
  const loaded = await loadChanges(leagueId)
  if (!loaded || !loaded.groups.length) return ''
  const seen = await getLeagueRulesSeen(userId, leagueId).catch(() => null)
  return ruleChangesForChimmy({ groups: loaded.groups, seen, now })
}

/**
 * Commish OS (lib/commissioner-workspace/taskSources.ts): one task while managers have not seen the
 * newest change. A failed read THROWS, like the other task readers, so reconciliation never closes an
 * open task on a snapshot it could not take.
 */
export async function readUnseenRuleChangeTasks(leagueId: string, now = new Date()): Promise<WorkspaceTaskCandidate[]> {
  const loaded = await loadChanges(leagueId)
  if (!loaded || !loaded.groups.length) return []
  const newest = loaded.groups[0]!
  const actors = new Set<string>([loaded.league.userId])
  for (const ev of loaded.events) if (newest.eventIds.includes(ev.id) && ev.actorUserId) actors.add(ev.actorUserId)
  const rosters = await prisma.roster.findMany({ where: { leagueId }, select: { platformUserId: true } })
  const members = [...new Set(rosters.map((r) => r.platformUserId).filter((id): id is string => typeof id === 'string' && id.length > 0))].filter(
    (id) => !actors.has(id),
  )
  const seenByUser = await getLeagueRulesSeenForUsers(members, leagueId)
  const task = detectUnseenRuleChange({
    leagueId,
    group: newest,
    members,
    seenByUser,
    broadcastsEnabled: isLeaguePrefEnabled(parseLeagueNotificationPrefs(loaded.league.settings), 'commissionerBroadcasts'),
    now,
  })
  return task ? [task] : []
}

import 'server-only'
import { prisma } from '@/lib/prisma'
import { liveAlertAllowed, readLiveAlertLevel, type LiveAlertKind, type LiveAlertLevel } from '@/lib/notification-settings/liveAlertLevel'

/**
 * Keep only the recipients whose live alert level allows this alert (lib/notification-settings/liveAlertLevel.ts).
 *
 * One query for the whole recipient list. Fails OPEN — a database hiccup keeps everyone, as every
 * other live-alert gate here does — because the dispatcher still applies each person's category and
 * channel switches, and "Off" people have usually also switched the categories off.
 */
export async function filterByLiveAlertLevel(
  userIds: string[],
  kind: LiveAlertKind,
  inGame: ReadonlySet<string> | ((userId: string) => boolean),
  deps: { readLevels?: (ids: string[]) => Promise<Map<string, LiveAlertLevel>> } = {},
): Promise<string[]> {
  if (userIds.length === 0) return []
  let levels: Map<string, LiveAlertLevel>
  try {
    levels = await (deps.readLevels ?? readLevels)(userIds)
  } catch {
    return userIds
  }
  const isInGame = typeof inGame === 'function' ? inGame : (id: string) => inGame.has(id)
  return userIds.filter(id => liveAlertAllowed(levels.get(id) ?? readLiveAlertLevel(null), kind, { inGame: isInGame(id) }))
}

async function readLevels(ids: string[]): Promise<Map<string, LiveAlertLevel>> {
  const rows = await prisma.userProfile.findMany({ where: { userId: { in: ids } }, select: { userId: true, notificationPreferences: true } })
  return new Map(rows.map(r => [r.userId, readLiveAlertLevel(r.notificationPreferences)]))
}

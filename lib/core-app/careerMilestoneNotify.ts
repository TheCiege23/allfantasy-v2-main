import 'server-only'

import { prisma } from '@/lib/prisma'
import { dispatchNotification } from '@/lib/notifications/NotificationDispatcher'
import { detectCareerMilestones } from './careerMilestoneEvents'
import type { StoredCareerProfile } from './careerProfile'

/**
 * Sends the milestone alerts a career profile rebuild earned. Category `career_milestones`.
 *
 * ⚠ THREE LIMITS, EACH FOR A REASON:
 *   - No previous profile → nothing. A first build (or a profile version bump) has no "before",
 *     and every award in it would otherwise arrive at once as news.
 *   - At most `MAX_PER_REBUILD`, titles first. A season ending in five leagues the same week is
 *     real, but five buzzes in a minute is how a category gets switched off.
 *   - Once per milestone, ever. `PlatformNotification.sourceKey` already dedupes the in-app ROW,
 *     but the dispatcher still sends push and email on a duplicate — so the key is checked here
 *     before dispatching, and an in-process set stops the two writers (the post-import refresh and
 *     a stale read's rebuild) racing each other inside one process.
 *
 * Never throws; it runs at the tail of profile writes.
 */

const MAX_PER_REBUILD = 3
const inFlight = new Set<string>()

export async function notifyCareerMilestones(
  userId: string,
  prev: StoredCareerProfile | null,
  next: StoredCareerProfile,
): Promise<number> {
  if (!prev) return 0
  let sent = 0
  try {
    const events = detectCareerMilestones(prev, next).slice(0, MAX_PER_REBUILD)
    for (const e of events) {
      const prefix = `career-milestone:${e.key}`
      const sourceKey = `${prefix}:${userId}`
      if (inFlight.has(sourceKey)) continue
      inFlight.add(sourceKey)
      try {
        const existing = await prisma.platformNotification
          .findFirst({ where: { sourceKey }, select: { id: true } })
          .catch(() => ({ id: 'unknown' }))
        // A failed lookup counts as "already sent": a missed alert is cheaper than a repeated push.
        if (existing) continue
        await dispatchNotification({
          userIds: [userId],
          category: 'career_milestones',
          type: 'career_milestone',
          title: e.title,
          body: e.body,
          actionHref: e.kind === 'award' ? '/core/career?view=awards' : '/core/career',
          actionLabel: e.kind === 'award' ? 'See your awards' : 'See your career',
          severity: 'low',
          dedupePrefix: prefix,
          /*
           * ⚠ ONE NOTIFICATION PER MILESTONE ON THE DEVICE. Without its own tag every push in a
           * category shares `notif-career_milestones-global` (pushTagFor), and the service worker
           * REPLACES a shown notification with the same tag, silently (`renotify: false`) — so of
           * the up-to-three milestones one rebuild earns, the phone kept only the last.
           */
          meta: { milestone: e.key, milestoneKind: e.kind, pushTag: prefix },
        })
        sent += 1
      } finally {
        inFlight.delete(sourceKey)
      }
    }
  } catch (err) {
    console.error('[career-milestones] notify failed', err)
  }
  return sent
}

import 'server-only'

import { prisma } from '@/lib/prisma'
import { dispatchNotification } from '@/lib/notifications/NotificationDispatcher'
import { recapNotificationCopy } from '@/lib/league-chat/weeklyRecapSweep'

/**
 * "Your league's recap is ready — share it": one push and in-app row per person per week, after the
 * Tuesday sweep has posted the recaps. Category `matchup_results`, like the weekly story beside it:
 * the recap IS a results recap, so whoever muted results does not get this either.
 *
 * ⚠ ONCE PER USER PER WEEK, CHECKED BEFORE DISPATCH. `PlatformNotification.sourceKey` dedupes the
 * in-app row but the dispatcher still pushes on a duplicate (see weeklyStoryNotify.ts), so existing
 * keys are read first and a failed read sends nothing. The key is the NFL season and week, so the
 * sweep's later fires, which post more leagues' recaps, never push the same person twice.
 *
 * Returns who was pushed, so the weekly-story push that runs right after can go in-app only for them —
 * two pushes in the same minute from the same cron is one too many.
 *
 * Never throws: it runs at the tail of the sweep.
 */

const PREFIX = 'weekly-recap'

export type PostedRecap = { leagueId: string; leagueName: string; ownerUserId: string; season: string; week: number }

export async function notifyWeeklyRecaps(posted: readonly PostedRecap[]): Promise<{ notified: Set<string>; sent: number; skipped: number }> {
  const notified = new Set<string>()
  if (posted.length === 0) return { notified, sent: 0, skipped: 0 }
  try {
    const leagueIds = [...new Set(posted.map((p) => p.leagueId))]
    const claimed = await prisma.leagueTeam.findMany({
      where: { leagueId: { in: leagueIds }, claimedByUserId: { not: null } },
      select: { leagueId: true, claimedByUserId: true },
    })
    const byUser = new Map<string, PostedRecap[]>()
    const add = (userId: string | null | undefined, recap: PostedRecap) => {
      if (!userId) return
      const list = byUser.get(userId) ?? []
      if (!list.some((r) => r.leagueId === recap.leagueId)) list.push(recap)
      byUser.set(userId, list)
    }
    for (const recap of posted) {
      add(recap.ownerUserId, recap)
      for (const t of claimed) if (t.leagueId === recap.leagueId) add(t.claimedByUserId, recap)
    }

    const keyOf = (userId: string, recaps: PostedRecap[]) => `${PREFIX}:${recaps[0]!.season}-w${recaps[0]!.week}:${userId}`
    const keys = [...byUser].map(([u, r]) => keyOf(u, r))
    const existing = await prisma.platformNotification
      .findMany({ where: { sourceKey: { in: keys } }, select: { sourceKey: true } })
      .catch(() => null)
    if (existing == null) return { notified, sent: 0, skipped: byUser.size }
    const done = new Set(existing.map((e) => e.sourceKey))

    let sent = 0
    for (const [userId, recaps] of byUser) {
      if (done.has(keyOf(userId, recaps))) continue
      const copy = recapNotificationCopy(recaps)
      if (!copy) continue
      const prefix = `${PREFIX}:${recaps[0]!.season}-w${recaps[0]!.week}`
      await dispatchNotification({
        userIds: [userId],
        category: 'matchup_results',
        type: 'weekly_recap',
        title: copy.title,
        body: copy.body,
        actionHref: copy.actionHref,
        actionLabel: 'Open the recap',
        leagueId: recaps[0]!.leagueId,
        severity: 'low',
        dedupePrefix: prefix,
        skipChannels: { email: true, sms: true },
        // Its own device tag, so it neither replaces nor is replaced by another results push.
        meta: { weeklyRecap: { season: recaps[0]!.season, week: recaps[0]!.week, leagues: recaps.length }, pushTag: prefix },
      })
      notified.add(userId)
      sent += 1
    }
    return { notified, sent, skipped: byUser.size - sent }
  } catch (err) {
    console.error('[weekly-recap] notify failed', err instanceof Error ? err.name : 'unknown')
    return { notified, sent: 0, skipped: 0 }
  }
}

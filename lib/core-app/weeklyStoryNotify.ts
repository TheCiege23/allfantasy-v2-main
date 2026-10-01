import 'server-only'

import { prisma } from '@/lib/prisma'
import { dispatchNotification } from '@/lib/notifications/NotificationDispatcher'

/**
 * The Tuesday "your weekly story is ready" push. Category `matchup_results` (user decision
 * 2026-10-01): the story IS a results recap, so whoever muted results does not get it, and there is
 * no new settings row to explain. It rides the existing `weekly-awards` cron because the cron
 * registry is full (60 of 60, `scripts/cron-budget-check.mjs`).
 *
 * ⚠ IT NAMES NO WEEK NUMBER. Which week is "last week" is decided per user, per league, by
 * `getWeekAll` when the story renders; a cron guessing it once for everyone could promise a week 4
 * story over a week 3 one. "Your weekly story is ready" is true for anyone it targets.
 *
 * ⚠ WHO IT TARGETS IS WHO WILL HAVE A STORY: a claimed team with a SCORED result written in the last
 * seven days, read from the same `WeeklyMatchup` rows `getWeekAll` reads (joined on the PROVIDER
 * league id, as `weekBoard.ts` does). Measured on production 2026-10-01: 31 users.
 *
 * ⚠ ONCE PER USER PER WEEK, CHECKED BEFORE DISPATCH. `PlatformNotification.sourceKey` dedupes the
 * in-app row, but the dispatcher still pushes on a duplicate (see `careerMilestoneNotify.ts`), so
 * existing keys are read first, in one query, and a failed read sends nothing.
 *
 * Never throws: it runs at the tail of another job.
 */

const PREFIX = 'weekly-story'
const CHUNK = 100

/** The key's week: the UTC date of the Monday that starts the cron's week, so re-fires dedupe. */
export function storyWeekKey(now: Date): string {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  const sinceMonday = (d.getUTCDay() + 6) % 7
  d.setUTCDate(d.getUTCDate() - sinceMonday)
  return d.toISOString().slice(0, 10)
}

export async function notifyWeeklyStories(now: Date = new Date()): Promise<{ targeted: number; sent: number; skipped: number }> {
  const prefix = `${PREFIX}:${storyWeekKey(now)}`
  try {
    const rows = await prisma.$queryRaw<Array<{ userId: string }>>`
      SELECT DISTINCT t."claimedByUserId" AS "userId"
      FROM "WeeklyMatchup" w
      JOIN leagues l ON l."platformLeagueId" = w."leagueId"
      JOIN league_teams t ON t."leagueId" = l.id AND t."externalId" = w."rosterId"
      WHERE w."pointsFor" > 0
        AND w."updatedAt" > ${new Date(now.getTime() - 7 * 24 * 60 * 60_000)}
        AND t."claimedByUserId" IS NOT NULL`
    const userIds = rows.map((r) => r.userId).filter(Boolean)
    if (userIds.length === 0) return { targeted: 0, sent: 0, skipped: 0 }

    const keys = userIds.map((u) => `${prefix}:${u}`)
    const existing = await prisma.platformNotification
      .findMany({ where: { sourceKey: { in: keys } }, select: { sourceKey: true } })
      .catch(() => null)
    // A failed lookup sends nothing: a missed Tuesday push is cheaper than a repeated one.
    if (existing == null) return { targeted: userIds.length, sent: 0, skipped: userIds.length }
    const done = new Set(existing.map((e) => e.sourceKey))
    const todo = userIds.filter((u) => !done.has(`${prefix}:${u}`))

    for (let i = 0; i < todo.length; i += CHUNK) {
      await dispatchNotification({
        userIds: todo.slice(i, i + CHUNK),
        category: 'matchup_results',
        type: 'weekly_story',
        title: 'Your weekly story is ready',
        body: 'Every league, last week — one card at a time. Chimmy has a line for you.',
        actionHref: '/core/career',
        actionLabel: 'Open your story',
        severity: 'low',
        dedupePrefix: prefix,
        // A push and an in-app row, never a weekly email or text (user decision: the push).
        skipChannels: { email: true, sms: true },
        meta: { weeklyStory: storyWeekKey(now) },
      })
    }
    return { targeted: userIds.length, sent: todo.length, skipped: userIds.length - todo.length }
  } catch (err) {
    console.error('[weekly-story] notify failed', err instanceof Error ? err.message : 'unknown')
    return { targeted: 0, sent: 0, skipped: 0 }
  }
}

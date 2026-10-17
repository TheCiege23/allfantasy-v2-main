/**
 * How many times a live game may buzz one person's phone.
 *
 * Every touchdown, 20-yard play, turnover, field goal and win-chance swing for a manager's
 * starters is its own alert (lib/live/bigPlayNotifier.ts, lib/live/starterSwings.ts), and each
 * one used to be its own push. A manager starting nine players across a Sunday slate could be
 * buzzed dozens of times an hour, and the useful alerts drowned in the minor ones.
 *
 * The rule, per person, over a rolling hour:
 *   - MAJOR alerts (severity `high`: touchdowns, defensive/special-teams scores, lead changes,
 *     the last-place cut line) push until the person has had LIVE_PUSH_CAP live pushes.
 *   - MINOR alerts (`medium`/`low`: big gains, turnovers, field goals, win-chance swings) push
 *     only while the person has had fewer than LIVE_PUSH_MINOR_CAP minor pushes AND is under the
 *     overall cap.
 * An alert over budget still lands in the notification bell — only the phone buzz is held.
 *
 * The count comes from the in-app rows the dispatcher writes, which carry `meta.pushBudget`
 * ('pushed' | 'held') and `meta.pushTier`. So the budget survives across cron ticks and worker
 * replicas with no new table. Two known softnesses, both in the direction of MORE pushes rather
 * than fewer: a person who turned the in-app channel off for this category has no rows to count,
 * and two replicas deciding in the same instant can each spend the last slot.
 */
import { prisma } from '@/lib/prisma'

export const LIVE_PUSH_WINDOW_MINUTES = 60
export const LIVE_PUSH_CAP = 8
export const LIVE_PUSH_MINOR_CAP = 3

export type LivePushTier = 'major' | 'minor'

export function livePushTier(severity: string | null | undefined): LivePushTier {
  return severity === 'high' ? 'major' : 'minor'
}

export type LivePushHistory = { total: number; minor: number }

/** Pure: may one more alert of `tier` push, given what this person has had this hour? */
export function livePushAllowed(history: LivePushHistory, tier: LivePushTier): boolean {
  if (history.total >= LIVE_PUSH_CAP) return false
  if (tier === 'minor' && history.minor >= LIVE_PUSH_MINOR_CAP) return false
  return true
}

type FindRecent = (args: {
  userIds: string[]
  since: Date
}) => Promise<{ userId: string; meta: unknown }[]>

const findRecentPushed: FindRecent = ({ userIds, since }) =>
  prisma.platformNotification.findMany({
    where: {
      userId: { in: userIds },
      type: 'live_score_swing',
      createdAt: { gte: since },
      meta: { path: ['pushBudget'], equals: 'pushed' },
    },
    select: { userId: true, meta: true },
  })

/**
 * Split recipients into those whose phone may buzz for this alert and those held to the bell.
 * Fails OPEN: if the history cannot be read, everyone pushes, exactly as before this existed —
 * a database hiccup must not silence a touchdown.
 */
export async function splitByLivePushBudget(
  userIds: string[],
  tier: LivePushTier,
  deps: { findRecent?: FindRecent; now?: Date } = {},
): Promise<{ push: string[]; held: string[] }> {
  if (userIds.length === 0) return { push: [], held: [] }
  const now = deps.now ?? new Date()
  const since = new Date(now.getTime() - LIVE_PUSH_WINDOW_MINUTES * 60_000)
  let rows: { userId: string; meta: unknown }[]
  try {
    rows = await (deps.findRecent ?? findRecentPushed)({ userIds, since })
  } catch {
    return { push: [...userIds], held: [] }
  }
  const history = new Map<string, LivePushHistory>()
  for (const row of rows ?? []) {
    const h = history.get(row.userId) ?? { total: 0, minor: 0 }
    h.total += 1
    const meta = row.meta as { pushTier?: unknown } | null
    if (meta?.pushTier === 'minor') h.minor += 1
    history.set(row.userId, h)
  }
  const push: string[] = []
  const held: string[] = []
  for (const id of userIds) {
    if (livePushAllowed(history.get(id) ?? { total: 0, minor: 0 }, tier)) push.push(id)
    else held.push(id)
  }
  return { push, held }
}

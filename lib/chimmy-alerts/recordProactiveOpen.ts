import 'server-only'

import { recordChimmyPersonalizationEvent } from '@/lib/chimmy-personalization'
import { resolvePlatformUser } from '@/lib/platform/current-user'
import { describeProactiveFrom, type ProactiveFrom } from './proactiveLinks'

/**
 * Someone opened Chimmy from a weekly message's link — count it.
 *
 * Recorded as the personalization layer's own `alert_clicked` event, which is exactly what it is:
 * Chimmy's inferred alert preference already weighs clicks against dismissals
 * (`lib/chimmy-personalization/service.ts`), so a manager who acts on these messages is also
 * treated as one who wants them. The row carries which check, which channel and which league, so
 * "did the lineup check bring anyone in" is one query:
 *
 *   engagement_events WHERE "eventType" = 'chimmy_personalization_event'
 *                       AND meta->>'type' = 'alert_clicked'
 *                       AND meta->>'surface' = 'chimmy_chat'
 *
 * Never throws and never blocks the page: a failed count costs a data point, not the answer.
 * Signed-out opens are not counted here — the sign-in redirect brings them back with the tag.
 */
export async function recordProactiveOpen(args: { from: ProactiveFrom; leagueId?: string | null }): Promise<void> {
  try {
    const user = await resolvePlatformUser()
    if (!user.appUserId) return
    const { alert, channel } = describeProactiveFrom(args.from)
    const leagueId = typeof args.leagueId === 'string' && /^[\w-]{1,64}$/.test(args.leagueId) ? args.leagueId : null
    await recordChimmyPersonalizationEvent(user.appUserId, {
      type: 'alert_clicked',
      metadata: { alert, channel, from: args.from, leagueId, surface: 'chimmy_chat' },
    })
  } catch {
    /* a lost count, never a lost page */
  }
}

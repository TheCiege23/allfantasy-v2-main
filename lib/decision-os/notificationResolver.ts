/**
 * Fantasy OS Suite — Phase OS-B4: Notification Engine Foundation.
 *
 * The standalone, fully self-contained resolver for `composeNotificationFeed` (`notifications.ts`) —
 * for a future consumer with no existing fetched signals/brief to compose from (a push/email delivery
 * job, a mobile client, Platform OS). Mirrors `attentionQueue.ts`/`dailyBriefResolver.ts`'s own
 * "standalone resolver, explicit tradeoff" precedent from OS-B2/OS-B3.
 *
 * Documented, accepted tradeoff — the third in this same chain: this resolver calls the already-
 * standalone `resolveAttentionQueueSnapshot` for the full signal list AND `resolveDailyBrief` for the
 * one brief-level notification. `resolveDailyBrief` ALREADY calls `resolveAttentionQueueSnapshot`
 * internally (OS-B3), so Mission Control ends up fetched more than once across this resolver's own
 * execution. Accepted for the same reason OS-B2/OS-B3 accepted it: `resolveNotificationFeed` targets
 * background-job callers with no page-load context to reuse, not a request stacked on an already-
 * fetched page. The Commissioner Hub's own Notification Center does NOT call this resolver — it
 * composes from data `CommissionerCommandCenterSection.tsx` already fetched/composed for its sibling
 * cards, with zero additional request. See `docs/os/NOTIFICATION_ENGINE.md` §4.
 */
import { resolveAttentionQueueSnapshot } from './attentionQueue'
import { resolveDailyBrief } from './dailyBriefResolver'
import { composeNotificationFeed, type DecisionOsNotification } from './notifications'

/**
 * Resolves the full notification feed for an EXPLICIT set of league IDs — the same "explicit-list
 * only, caller resolves authorization" contract every sibling Decision OS composition follows. Never
 * throws — both dependencies already degrade honestly on their own failures.
 */
export async function resolveNotificationFeed(
  leagueIds: readonly string[],
  now: Date = new Date(),
): Promise<DecisionOsNotification[]> {
  const [attentionSnapshot, brief] = await Promise.all([
    resolveAttentionQueueSnapshot(leagueIds, now),
    resolveDailyBrief(leagueIds, now),
  ])

  return composeNotificationFeed({ signals: attentionSnapshot.signals, brief })
}

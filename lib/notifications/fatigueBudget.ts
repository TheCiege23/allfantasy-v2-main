/**
 * NOTIFICATION FATIGUE BUDGET — the volume half of R7's "one outbox, four transports, one
 * fatigue budget enforced in the outbox".
 *
 * ── WHAT WAS ALREADY THERE, AND WHY IT IS NOT THIS ──────────────────────────────────────────
 * `ChimmyAlertEngine` has real suppression: `suppressDuplicateAlerts`, `repeatCooldownMinutes`,
 * and a per-preference cooldown multiplier. That is a COOLDOWN — "do not tell me about the same
 * thing twice within N minutes". A fatigue BUDGET is a different question: "do not send me more
 * than N notifications a day, whatever they are about". Ten distinct alerts pass every cooldown
 * check and still arrive as ten notifications.
 *
 * ⚠ AND THAT SUPPRESSION ONLY COVERS CHIMMY ALERTS. Waiver results, trade events and marketing
 * broadcasts enqueue straight into `notification_outbox` and never pass through it. The outbox is
 * where every path converges, which is exactly why R7 specifies the budget there and not in one
 * producer.
 *
 * ── 🛑 THE DEFAULT IS EXEMPT, AND THAT IS THE WHOLE SAFETY ARGUMENT ─────────────────────────
 * A naive per-user cap does real harm. The relay drains oldest-first, so a morning marketing
 * batch would consume the day's budget and the afternoon "your waiver claim won" would be the
 * row that gets dropped — the budget would suppress precisely the notification the user is
 * waiting for, and silently.
 *
 * So this classifies from `eventType` and **an unrecognised eventType is NEVER suppressed**.
 * Only types explicitly listed as bulk are eligible. That means the budget starts narrow and can
 * only ever be widened deliberately; a new transactional event added tomorrow is safe on the day
 * it lands, without anyone remembering this file exists.
 *
 * ⚠ `notification_outbox` HAS NO CATEGORY COLUMN. `NotificationCategoryId` exists in
 * `lib/notification-settings/types.ts` with eighteen categories, but the outbox row carries only
 * a free-string `eventType`. Mapping the two properly wants a column, and a migration is not
 * something this change may add. Classifying in code with a fail-safe default is the honest
 * version of that constraint rather than a workaround for it.
 */
import { prisma } from '@/lib/prisma'

/**
 * Event types the budget MAY suppress. Everything absent from this set is exempt.
 *
 * ⚠ DELIBERATELY SHORT. These are the only types observed in production or in the enqueue sites
 * that are unambiguously bulk — sent TO a user rather than ABOUT something they did. Anything
 * transactional (`WAIVER_CLAIM_WON`, `af_trade_*`, draft and lineup alerts) is exempt by being
 * absent, and must stay that way: a user who misses a claim result because of a volume cap has
 * been harmed by the thing meant to protect them.
 */
const FATIGUE_ELIGIBLE_EVENT_TYPES: ReadonlySet<string> = new Set([
  'admin_marketing_broadcast',
  'admin_marketing_test',
])

/** Rolling window the cap is measured over. */
export const FATIGUE_WINDOW_MS = 24 * 60 * 60 * 1000

/**
 * Maximum bulk notifications per user per window.
 *
 * ⚠ A CAP THAT NEVER FIRES IS DECORATION, AND ONE THAT FIRES TOO EASILY IS AN OUTAGE. This is
 * deliberately generous: it is a flood guard, not an editorial policy. Tightening it is a product
 * decision, and it is a constant here rather than an env var because an unset env var reading as
 * "no limit" is the dead-switch failure this repo already records for AF_DISABLE_AI_LIVE_CALLS.
 */
export const FATIGUE_MAX_PER_WINDOW = 10

/** Pure: may the budget consider suppressing this event type at all? */
export function isFatigueEligible(eventType: string | null | undefined): boolean {
  if (typeof eventType !== 'string') return false
  return FATIGUE_ELIGIBLE_EVENT_TYPES.has(eventType.trim())
}

export interface FatigueDecision {
  /** True when this row must NOT be delivered now. */
  suppress: boolean
  /** Populated only when suppressing — goes into the row's `lastError` so it is auditable. */
  reason?: string
}

const ALLOW: FatigueDecision = { suppress: false }

/**
 * Decide whether one outbox row is over its recipient's budget.
 *
 * ⚠ FAILS OPEN, LIKE EVERY OTHER GUARD IN THIS RELAY. An unreadable count must not silence a
 * user's notifications — a budget that cannot measure has no business refusing. The catch returns
 * ALLOW, so the worst case is that the cap does not apply for one pass.
 *
 * ⚠ IT COUNTS ONLY WHAT WAS ACTUALLY SENT, in the window, to this user, among ELIGIBLE types.
 * Counting every row would let a transactional burst consume the bulk budget — which inverts the
 * protection, since the bulk messages would then be dropped because the user had a busy waiver
 * day. The two populations are kept separate on purpose.
 */
export async function decideFatigue(
  row: { userId: string | null; eventType: string | null },
  now: Date = new Date(),
): Promise<FatigueDecision> {
  if (!row.userId) return ALLOW
  if (!isFatigueEligible(row.eventType)) return ALLOW

  try {
    const since = new Date(now.getTime() - FATIGUE_WINDOW_MS)
    const sent = await prisma.notificationOutbox.count({
      where: {
        userId: row.userId,
        status: 'sent',
        sentAt: { gte: since },
        eventType: { in: [...FATIGUE_ELIGIBLE_EVENT_TYPES] },
      },
    })
    if (sent < FATIGUE_MAX_PER_WINDOW) return ALLOW
    return {
      suppress: true,
      reason:
        `fatigue budget: ${sent} bulk notifications already sent to this user in the last ` +
        `${FATIGUE_WINDOW_MS / 3_600_000}h (cap ${FATIGUE_MAX_PER_WINDOW})`,
    }
  } catch {
    return ALLOW
  }
}

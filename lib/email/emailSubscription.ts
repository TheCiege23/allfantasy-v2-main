import { prisma } from "@/lib/prisma"

/**
 * Has this address clicked Unsubscribe (or bounced / complained — the Resend webhook writes the
 * same row)? `EmailPreference` is keyed by ADDRESS, not user, and is matched case-insensitively,
 * the same way the chat notifier always has.
 *
 * Three answers, and the third is the one that matters:
 *   { unsubscribedAt: Date }  — opted out; do not send alert emails
 *   { unsubscribedAt: null }  — no opt-out on file
 *   "unknown"                 — the read FAILED. Callers that send must treat this as "do not
 *                               send": emailing someone who unsubscribed is the worse error, and
 *                               the in-app row still records the alert.
 */
export type EmailSubscriptionState = { unsubscribedAt: Date | null } | "unknown"

export async function readEmailSubscription(email: string | null | undefined): Promise<EmailSubscriptionState> {
  if (!email) return { unsubscribedAt: null }
  try {
    const row = await prisma.emailPreference.findFirst({
      where: { email: { equals: email, mode: "insensitive" } },
      select: { unsubscribedAt: true },
    })
    return { unsubscribedAt: row?.unsubscribedAt ?? null }
  } catch {
    return "unknown"
  }
}

/**
 * Categories that are account notices, not alerts. The unsubscribe page promises these may still
 * be sent ("account notices"), so an opt-out never silences them.
 */
export const EMAIL_UNSUBSCRIBE_EXEMPT_CATEGORIES: ReadonlySet<string> = new Set(["system_account"])

/**
 * Should an alert email in `category` be withheld for this state? `undefined` — a profile built
 * without the field (older callers, test doubles) — is treated as "no opt-out known", so adding
 * the check cannot silence a path that never loaded it; a FAILED read is "unknown" and withholds.
 */
export function emailWithheldByUnsubscribe(
  state: EmailSubscriptionState | undefined,
  category: string,
): boolean {
  if (EMAIL_UNSUBSCRIBE_EXEMPT_CATEGORIES.has(category)) return false
  if (state === undefined) return false
  if (state === "unknown") return true
  return state.unsubscribedAt != null
}

/**
 * Resume alert emails for this address: clears the opt-out and turns trade-alert emails back on.
 * It deliberately leaves `productUpdates` and `weeklyDigest` (marketing) as the unsubscribe left
 * them — asking for alert emails back is not asking for marketing.
 */
export async function resumeAlertEmails(email: string): Promise<number> {
  const res = await prisma.emailPreference.updateMany({
    where: { email: { equals: email, mode: "insensitive" } },
    data: { unsubscribedAt: null, tradeAlerts: true },
  })
  return res.count
}

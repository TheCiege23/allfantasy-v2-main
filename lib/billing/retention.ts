/**
 * KEEPING THE PEOPLE WHO PAY — the rules and the words, PURE (owner's call 2026-11-15: "yes, build the
 * retention work"). Three moments, each of which used to pass in silence:
 *
 *   1. A CARD FAILS. The webhook marked the row `past_due` and told nobody, so the first sign was losing
 *      access. Now: an email + bell notice the moment Stripe reports it (once per invoice, however many
 *      times Stripe retries), a banner on every /core screen while it lasts, and a last notice the day
 *      before the grace period ends.
 *   2. A TRIAL ENDS. Nothing in the app said "you are about to be charged". Now: two days before the
 *      first charge, an email that says what AF Pro actually did for this person that week, the date
 *      and the plan, and how to cancel. Only for a trial that is still set to renew (re-read from Stripe).
 *   3. A PLAN IS CANCELLED. Nothing followed. Now: one "come back" note three days later — only if they
 *      have not already come back, and never by email to an address that clicked Unsubscribe.
 *
 * STRIPE ONLY. Apple and Google send their own billing notices, and the iOS app never shows the banner
 * (App Store 3.1.1: no pointing at another way to pay).
 */

const HOUR = 3_600_000

/** The day-before notice: grace ending 12–48 hours from now. Hourly runs see each one many times. */
export const FINAL_NOTICE_WINDOW = { fromMs: 12 * HOUR, toMs: 48 * HOUR }
/** Trial-ending: the first charge 36–60 hours from now, i.e. about two days before it. */
export const TRIAL_ENDING_WINDOW = { fromMs: 36 * HOUR, toMs: 60 * HOUR }
/** Win-back: a cancellation 72–96 hours ago. */
export const WIN_BACK_WINDOW = { fromMs: 72 * HOUR, toMs: 96 * HOUR }

export const BILLING_PORTAL_HREF = '/api/subscription/billing-portal'
export const BILLING_SETTINGS_HREF = '/settings?tab=billing'

export type RetentionNotice = { title: string; body: string }

/** "Nov 22" in the reader's terms (US Eastern, the app's default). */
export function formatBillingDate(d: Date, timeZone = 'America/New_York'): string {
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone })
}

export function paymentFailedNotice(accessEndsOn: string | null): RetentionNotice {
  return {
    title: "Your payment didn't go through",
    body: accessEndsOn
      ? `We couldn't charge your card for AF Pro. Your access stays on until ${accessEndsOn}. Update your card and nothing changes.`
      : `We couldn't charge your card for AF Pro. Update your card and nothing changes.`,
  }
}

export function paymentFinalNotice(accessEndsOn: string): RetentionNotice {
  return {
    title: 'AF Pro ends tomorrow unless your card is updated',
    body: `Your last payment still hasn't gone through, and AF Pro switches off on ${accessEndsOn}. It takes a minute to update your card.`,
  }
}

/** What AF Pro did for this person during the trial, from the advice ledger. Facts only. */
export type TrialWeekCounts = { lineupCalls: number; waiverPicks: number; leagues: number }

export function trialWeekSummary(c: TrialWeekCounts): string | null {
  const parts: string[] = []
  if (c.lineupCalls > 0) parts.push(`${c.lineupCalls} lineup call${c.lineupCalls === 1 ? '' : 's'}`)
  if (c.waiverPicks > 0) parts.push(`${c.waiverPicks} waiver pick${c.waiverPicks === 1 ? '' : 's'}`)
  if (!parts.length) return null
  const list = parts.length === 2 ? `${parts[0]} and ${parts[1]}` : parts[0]
  const where = c.leagues > 1 ? ` across ${c.leagues} leagues` : ''
  return `This week Chimmy gave you ${list}${where}.`
}

export function trialEndingNotice(input: { planName: string; chargeOn: string; summary: string | null }): RetentionNotice {
  const lead = input.summary ?? 'Your AF Pro trial is almost over.'
  return {
    title: `Your AF Pro trial ends ${input.chargeOn}`,
    body: `${lead} Your trial ends ${input.chargeOn}, and ${input.planName} starts then on the card you added. To keep it, do nothing. To stop, cancel in Settings → Billing before then and you won't be charged.`,
  }
}

export function winBackNotice(): RetentionNotice {
  return {
    title: 'Your AF Pro has ended',
    body: "Your leagues and history are still here. If you want the lineup calls, waiver picks and trade grades back, you can restart AF Pro in a minute, whenever you're ready.",
  }
}

/** Statuses that mean a plan is still running (or recoverable) — a win-back is not for them. */
export const LIVE_STATUSES: readonly string[] = ['active', 'trialing', 'past_due', 'grace']

/* ── Admin: did the three moments end well? ─────────────────────────────────────────────────── */

export type RetentionEvent = { event: string; userId: string | null; createdAt: Date; meta: Record<string, unknown> | null }

export type RetentionStats = {
  failedInvoices: number
  recoveredInvoices: number
  trialsStarted: number
  trialsConverted: number
  cancellations: number
  cameBack: number
}

/**
 * PURE. Over a window of events:
 *   - failed / recovered: distinct invoices (`invoice_id`) — Stripe retries one invoice several times.
 *   - trials started vs converted: distinct users; a conversion is the paid conversion `from_trial`.
 *   - cancellations vs came back: distinct users who cancelled, and of those, how many have a paid
 *     conversion AFTER their cancellation.
 */
export function summarizeRetention(
  events: readonly RetentionEvent[],
  names: { failed: string; recovered: string; trialStarted: string; paid: string; canceled: string },
): RetentionStats {
  const failed = new Set<string>()
  const recovered = new Set<string>()
  const trialUsers = new Set<string>()
  const convertedTrialUsers = new Set<string>()
  const firstCancel = new Map<string, Date>()
  const paidAt = new Map<string, Date[]>()
  for (const e of events) {
    const invoice = typeof e.meta?.invoice_id === 'string' ? e.meta.invoice_id : null
    if (e.event === names.failed && invoice) failed.add(invoice)
    else if (e.event === names.recovered && invoice) recovered.add(invoice)
    else if (e.event === names.trialStarted && e.userId) trialUsers.add(e.userId)
    else if (e.event === names.paid && e.userId) {
      if (e.meta?.from_trial === true) convertedTrialUsers.add(e.userId)
      paidAt.set(e.userId, [...(paidAt.get(e.userId) ?? []), e.createdAt])
    } else if (e.event === names.canceled && e.userId) {
      const seen = firstCancel.get(e.userId)
      if (!seen || e.createdAt < seen) firstCancel.set(e.userId, e.createdAt)
    }
  }
  let cameBack = 0
  for (const [userId, at] of firstCancel) if ((paidAt.get(userId) ?? []).some((p) => p > at)) cameBack++
  return {
    failedInvoices: failed.size,
    recoveredInvoices: [...recovered].filter((i) => failed.has(i)).length,
    trialsStarted: trialUsers.size,
    trialsConverted: [...convertedTrialUsers].filter((u) => trialUsers.has(u)).length,
    cancellations: firstCancel.size,
    cameBack,
  }
}

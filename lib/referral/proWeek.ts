/**
 * "GIVE A WEEK, GET A WEEK" — the rules, PURE (owner's call 2026-11-15).
 *
 *   - When someone a member referred BRINGS A LEAGUE — imports one, or joins one through an invite
 *     (2026-11-15, leaguemate invites) — both of them get a week of AF Pro, free: no card, nothing to
 *     cancel. The league, not the sign-up, is the trigger — it is the funnel's own activation, and a
 *     throwaway account that never brings a league earns nobody anything.
 *   - Once per referred friend, ever (`lib/referral/proWeekGrant.ts` claims it on the referral row).
 *   - The REFERRER earns at most `REFERRER_WEEKS_PER_WINDOW` weeks in any rolling 30 days, so a
 *     referral link cannot be farmed into permanent Pro. The FRIEND's week is never capped.
 *   - Weeks STACK: a second week starts when the first ends, never alongside it.
 *   - The week is an `AdminSubscriptionGrant` (tier `pro`) — what `EntitlementResolver` already treats
 *     as active Pro. It is not a `UserSubscription`, so it never counts as MRR (`mrrEstimate.ts`) and
 *     never spends the friend's card trial (`freeTrialEligibility.ts` counts subscriptions only).
 *   - 🛑 THE OFFER IS NEVER ADVERTISED INSIDE THE iOS APP. App Store 3.1.1 bars unlocking paid features
 *     except through Apple's purchases; access earned elsewhere and carried across devices is the
 *     accepted case (3.1.3(b)). So the week is honoured everywhere, but every surface that PROMOTES it
 *     hides in a native build — the split the free trial already uses.
 *   - `AF_REFERRAL_PRO_WEEK_DAYS` is the kill switch and the dial: unset → 7, `0` or `off` → no
 *     reward, any other whole number → that many days, clamped to 1..30.
 */

export const DEFAULT_PRO_WEEK_DAYS = 7
export const MAX_PRO_WEEK_DAYS = 30
export const REFERRER_WEEKS_PER_WINDOW = 4
export const REFERRER_WINDOW_DAYS = 30

/** `AdminSubscriptionGrant.reason` for each side — how the grants are told apart and counted. */
export const PRO_WEEK_REASON_FRIEND = 'referral_pro_week:friend'
export const PRO_WEEK_REASON_REFERRER = 'referral_pro_week:referrer'
export const PRO_WEEK_REASONS: readonly string[] = [PRO_WEEK_REASON_FRIEND, PRO_WEEK_REASON_REFERRER]
/** `grantedByAdminId` / `grantedByEmail` on a grant no admin made. */
export const PRO_WEEK_GRANTED_BY = 'system:referral'

/** The key the claim writes on `Referral.metadata`. Present → this friend's weeks were handed out. */
export const PRO_WEEK_CLAIM_KEY = 'proWeekClaimedAt'

const DAY_MS = 86_400_000

export function proWeekDaysFromEnv(env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env): number {
  const raw = String(env.AF_REFERRAL_PRO_WEEK_DAYS ?? '').trim().toLowerCase()
  if (!raw) return DEFAULT_PRO_WEEK_DAYS
  if (raw === 'off' || raw === 'false' || raw === 'no') return 0
  const n = Number(raw)
  if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) return 0
  return Math.min(n, MAX_PRO_WEEK_DAYS)
}

/**
 * When a new week runs: from now, or from the end of the latest referral week still running — so two
 * weeks earned back to back give fourteen days, not seven twice over. `EntitlementResolver` reads only
 * `expiresAt`, so `startsAt` is the moment of the grant and the stacking lives in `expiresAt`.
 */
export function proWeekWindow(now: Date, latestRunningExpiry: Date | null, days: number): { startsAt: Date; expiresAt: Date } {
  const from = latestRunningExpiry && latestRunningExpiry > now ? latestRunningExpiry : now
  return { startsAt: now, expiresAt: new Date(from.getTime() + days * DAY_MS) }
}

/** The start of the referrer's rolling cap window. */
export function referrerWindowStart(now: Date): Date {
  return new Date(now.getTime() - REFERRER_WINDOW_DAYS * DAY_MS)
}

export function referrerCapReached(weeksInWindow: number): boolean {
  return weeksInWindow >= REFERRER_WEEKS_PER_WINDOW
}

/** "Nov 22" — the date a week ends, in the reader's terms. */
export function formatProWeekEnd(d: Date, timeZone = 'America/New_York'): string {
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone })
}

/** The name a notice uses for the other person: their display name, else their username, else "A friend". */
export function proWeekPersonName(u: { displayName?: string | null; username?: string | null } | null | undefined): string {
  const name = (u?.displayName ?? '').trim() || (u?.username ?? '').trim()
  return name ? name.slice(0, 40) : 'A friend'
}

export type ProWeekNotice = { title: string; body: string }

export function friendProWeekNotice(referrerName: string, days: number, endsOn: string): ProWeekNotice {
  return {
    title: `You've got ${days} days of AF Pro, free`,
    body: `${referrerName} invited you, and you brought a league, so you both get ${days} days of AF Pro. No card and nothing to cancel. It ends ${endsOn}.`,
  }
}

export function referrerProWeekNotice(friendName: string, days: number, endsOn: string): ProWeekNotice {
  return {
    title: `${friendName} joined. You've got ${days} days of AF Pro`,
    body: `${friendName} used your link and brought a league, so you both get ${days} days of AF Pro, free. Yours runs until ${endsOn}.`,
  }
}

export function referrerCappedNotice(friendName: string): ProWeekNotice {
  return {
    title: `${friendName} joined with your link`,
    body: `${friendName} brought a league and has a free week of AF Pro. You've already earned ${REFERRER_WEEKS_PER_WINDOW} free weeks in the last 30 days, which is the most one month can hold, so this one doesn't add another. Thanks for bringing people in.`,
  }
}

export function proWeekEndingNotice(endsOn: string): ProWeekNotice {
  return {
    title: 'Your free week of AF Pro ends tomorrow',
    body: `Your free AF Pro ends ${endsOn}. Upgrade to keep it, or bring another friend: when they bring a league you both get another week.`,
  }
}

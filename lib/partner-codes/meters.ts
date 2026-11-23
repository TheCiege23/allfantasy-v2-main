/**
 * Commissioner Partner Codes — the two meters and the rewards they unlock.
 *
 *   Paid subscribers  → cash commission (cashThresholdPaidSubs) and AF Supreme free (freeSupremePaidSubs)
 *   Active users      → AF Commissioner free, then AF Supreme free
 *
 * A paid subscriber is also an active user, so it counts on both meters.
 * Pure functions; the daily job feeds them rows and writes the result back.
 */
import type { PartnerSettings } from './settings'
import { daysBetween } from './money'

export type ReferralStatus = 'pending' | 'qualified' | 'churned' | 'refunded' | 'flagged' | 'rejected'

export type ReferralForMeters = {
  status: ReferralStatus
  /** First successful payment, any platform. null = never paid. */
  firstPaidAt: Date | null
  /** Has a subscription in good standing right now. */
  currentlyPaying: boolean
  /** Distinct days seen in the trailing activeWindowDays. */
  activeDaysInWindow: number
}

/** Flagged and rejected referrals count on neither meter until an admin clears them. */
function countable(r: ReferralForMeters): boolean {
  return r.status !== 'flagged' && r.status !== 'rejected' && r.status !== 'refunded'
}

export function isPaidSubscriber(r: ReferralForMeters, now: Date, s: PartnerSettings): boolean {
  return (
    countable(r) &&
    r.currentlyPaying &&
    r.firstPaidAt != null &&
    daysBetween(r.firstPaidAt, now) >= s.paymentClearDays
  )
}

export function isActiveUser(r: ReferralForMeters, now: Date, s: PartnerSettings): boolean {
  return countable(r) && (r.activeDaysInWindow >= s.activeMinDays || isPaidSubscriber(r, now, s))
}

export function countMeters(rows: ReferralForMeters[], now: Date, s: PartnerSettings) {
  let paidSubs = 0
  let activeUsers = 0
  let pending = 0
  for (const r of rows) {
    if (isPaidSubscriber(r, now, s)) paidSubs++
    if (isActiveUser(r, now, s)) activeUsers++
    if (countable(r) && r.firstPaidAt && r.currentlyPaying && !isPaidSubscriber(r, now, s)) pending++
  }
  return { paidSubs, activeUsers, pendingPaid: pending }
}

// ---------------------------------------------------------------------------
// Free-plan rewards with a hold (to unlock) and a grace period (to lose)
// ---------------------------------------------------------------------------

export type LevelState = {
  /** When the meter last went at-or-above this level's bar. null = currently below. */
  aboveSince: Date | null
  /** When the meter last dropped below the bar while granted. null = not in grace. */
  belowSince: Date | null
  granted: boolean
}

export const EMPTY_LEVEL: LevelState = { aboveSince: null, belowSince: null, granted: false }

/** Advance one level by one observation. */
export function stepLevel(prev: LevelState, isAbove: boolean, now: Date, holdDays: number, graceDays: number): LevelState {
  if (isAbove) {
    const aboveSince = prev.aboveSince ?? now
    const granted = prev.granted || daysBetween(aboveSince, now) >= holdDays
    return { aboveSince, belowSince: null, granted }
  }
  if (!prev.granted) return { aboveSince: null, belowSince: null, granted: false }
  const belowSince = prev.belowSince ?? now
  if (daysBetween(belowSince, now) >= graceDays) return { aboveSince: null, belowSince: null, granted: false }
  return { aboveSince: null, belowSince, granted: true }
}

export type RewardLevels = {
  commissionerActive: LevelState
  supremeActive: LevelState
  supremePaid: LevelState
}

export type FreePlan = 'none' | 'commissioner' | 'supreme'

export function stepRewards(
  prev: RewardLevels,
  meters: { paidSubs: number; activeUsers: number },
  now: Date,
  s: PartnerSettings,
): { levels: RewardLevels; freePlan: FreePlan } {
  const levels: RewardLevels = {
    commissionerActive: stepLevel(prev.commissionerActive, meters.activeUsers >= s.freeCommissionerActiveUsers, now, s.rewardHoldDays, s.rewardGraceDays),
    supremeActive: stepLevel(prev.supremeActive, meters.activeUsers >= s.freeSupremeActiveUsers, now, s.rewardHoldDays, s.rewardGraceDays),
    // Paid subscribers only count after their payment has cleared, so no second hold here.
    supremePaid: stepLevel(prev.supremePaid, meters.paidSubs >= s.freeSupremePaidSubs, now, 0, s.rewardGraceDays),
  }
  const freePlan: FreePlan =
    levels.supremeActive.granted || levels.supremePaid.granted
      ? 'supreme'
      : levels.commissionerActive.granted
        ? 'commissioner'
        : 'none'
  return { levels, freePlan }
}

/**
 * Cash turns on once, the first time the paid meter reaches the bar, and only
 * payments made after that moment earn (no back pay). It does not turn off when
 * the count dips — subscribers who leave simply stop earning.
 */
export function shouldUnlockCash(cashUnlockedAt: Date | null, paidSubs: number, s: PartnerSettings): boolean {
  return cashUnlockedAt == null && paidSubs >= s.cashThresholdPaidSubs
}

export function paymentEarnsCommission(paidAt: Date, cashUnlockedAt: Date | null): boolean {
  return cashUnlockedAt != null && paidAt.getTime() >= cashUnlockedAt.getTime()
}

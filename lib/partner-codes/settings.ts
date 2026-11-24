/**
 * Commissioner Partner Codes — program settings.
 *
 * Every number here is ADMIN-EDITABLE: the live values live in the single
 * `PartnerProgramSettings` row and are edited at /admin/partner-codes. These
 * defaults seed that row and are what tests run against. Never hardcode one of
 * these numbers anywhere else — read `PartnerProgramSettings` (see `loadPartnerSettings`).
 *
 * All money is integer cents. Commission is tracked in MILLICENTS (1/1000 of a
 * cent) on the ledger so 1,000 small invoices sum exactly — 10% of $9.99 is
 * 99.9 cents, and rounding each invoice to a cent would turn $999.00 into
 * $1,000.00 across 1,000 users. Payout totals round once, at the end.
 */

export type YearlyDiscountMode = 'prorated' | 'full_year'
export type CommissionBasis = 'net' | 'gross'

export type PartnerSettings = {
  /** Friend discount, percent off. */
  discountPercent: number
  /** How many monthly bills the friend discount covers. */
  discountMonths: number
  /**
   * Yearly plans: `prorated` = discountPercent off `discountMonths/12` of the
   * annual price, taken once (10% × 3/12 = 2.5% off a year). `full_year` =
   * discountPercent off the whole first year.
   */
  yearlyDiscountMode: YearlyDiscountMode
  /** Cash commission, percent of the basis. Flat — it does not rise with volume. */
  commissionPercent: number
  /** `net` = after store/processor fees and refunds; `gross` = what the subscriber paid. */
  commissionBasis: CommissionBasis
  /**
   * The App Store / Google Play cut, percent, used as the fee on store purchases (the stores do not
   * report it per sale). 15 = Apple's Small Business Program and every Google subscription.
   */
  storeFeePercent: number
  /** Stop paying on a subscriber after this many months of their payments. null = no limit. */
  commissionCapMonths: number | null
  /** Paid subscribers needed before cash commission starts. */
  cashThresholdPaidSubs: number
  /** Paid subscribers needed for free AF Supreme. */
  freeSupremePaidSubs: number
  /** Active users (free or paid) needed for free AF Commissioner. */
  freeCommissionerActiveUsers: number
  /** Active users (free or paid) needed for free AF Supreme. */
  freeSupremeActiveUsers: number
  /** A free-plan reward unlocks after the meter has held its bar this many days in a row. */
  rewardHoldDays: number
  /** After dropping below a bar, the reward stays on this many days before turning off. */
  rewardGraceDays: number
  /** An "active user" opened AF on at least this many distinct days ... */
  activeMinDays: number
  /** ... within this many trailing days. */
  activeWindowDays: number
  /** A payment counts (for meters and payouts) once it is this many days old with no refund. */
  paymentClearDays: number
  /** Balances under this roll over to the next month. */
  minPayoutCents: number
  /**
   * Statements up to this amount are sent automatically (no admin approval) when the commissioner's
   * Stripe payout account is active and none of the statement's subscribers is flagged. 0 = off:
   * every statement waits for an admin, whose approval then sends it.
   */
  autoSendMaxCents: number
  /** Max code changes per rolling 365 days. Old codes keep working. */
  maxCodeChangesPerYear: number
}

export const DEFAULT_PARTNER_SETTINGS: PartnerSettings = {
  discountPercent: 10,
  discountMonths: 3,
  yearlyDiscountMode: 'prorated',
  commissionPercent: 10,
  commissionBasis: 'net',
  storeFeePercent: 15,
  commissionCapMonths: null,
  cashThresholdPaidSubs: 10,
  freeSupremePaidSubs: 10,
  freeCommissionerActiveUsers: 15,
  freeSupremeActiveUsers: 50,
  rewardHoldDays: 30,
  rewardGraceDays: 30,
  activeMinDays: 4,
  activeWindowDays: 28,
  paymentClearDays: 30,
  minPayoutCents: 2500,
  autoSendMaxCents: 0,
  maxCodeChangesPerYear: 2,
}

const INT_KEYS = [
  'discountPercent',
  'discountMonths',
  'commissionPercent',
  'storeFeePercent',
  'cashThresholdPaidSubs',
  'freeSupremePaidSubs',
  'freeCommissionerActiveUsers',
  'freeSupremeActiveUsers',
  'rewardHoldDays',
  'rewardGraceDays',
  'activeMinDays',
  'activeWindowDays',
  'paymentClearDays',
  'minPayoutCents',
  'autoSendMaxCents',
  'maxCodeChangesPerYear',
] as const

const LIMITS: Record<(typeof INT_KEYS)[number], [number, number]> = {
  discountPercent: [0, 50],
  discountMonths: [1, 12],
  commissionPercent: [0, 30],
  storeFeePercent: [0, 50],
  cashThresholdPaidSubs: [1, 100_000],
  freeSupremePaidSubs: [1, 100_000],
  freeCommissionerActiveUsers: [1, 100_000],
  freeSupremeActiveUsers: [1, 100_000],
  rewardHoldDays: [0, 365],
  rewardGraceDays: [0, 365],
  activeMinDays: [1, 31],
  activeWindowDays: [7, 90],
  paymentClearDays: [0, 180],
  minPayoutCents: [0, 100_000],
  autoSendMaxCents: [0, 500_000],
  maxCodeChangesPerYear: [0, 12],
}

export class PartnerSettingsError extends Error {
  constructor(public field: string, message: string) {
    super(message)
    this.name = 'PartnerSettingsError'
  }
}

/**
 * Validate an admin edit. Unknown keys are ignored; every supplied value is
 * range-checked and the merged result returned. Throws PartnerSettingsError
 * naming the first bad field — the admin form shows it next to that input.
 */
export function mergePartnerSettings(
  base: PartnerSettings,
  patch: Partial<Record<keyof PartnerSettings, unknown>>,
): PartnerSettings {
  const out: PartnerSettings = { ...base }
  for (const key of INT_KEYS) {
    if (!(key in patch)) continue
    const v = Number(patch[key])
    const [lo, hi] = LIMITS[key]
    if (!Number.isInteger(v) || v < lo || v > hi) {
      throw new PartnerSettingsError(key, `${key} must be a whole number from ${lo} to ${hi}`)
    }
    out[key] = v
  }
  if ('yearlyDiscountMode' in patch) {
    const v = patch.yearlyDiscountMode
    if (v !== 'prorated' && v !== 'full_year') {
      throw new PartnerSettingsError('yearlyDiscountMode', 'yearlyDiscountMode must be prorated or full_year')
    }
    out.yearlyDiscountMode = v
  }
  if ('commissionBasis' in patch) {
    const v = patch.commissionBasis
    if (v !== 'net' && v !== 'gross') {
      throw new PartnerSettingsError('commissionBasis', 'commissionBasis must be net or gross')
    }
    out.commissionBasis = v
  }
  if ('commissionCapMonths' in patch) {
    const v = patch.commissionCapMonths
    if (v === null || v === '' || v === undefined) out.commissionCapMonths = null
    else {
      const n = Number(v)
      if (!Number.isInteger(n) || n < 1 || n > 120) {
        throw new PartnerSettingsError('commissionCapMonths', 'commissionCapMonths must be empty or 1 to 120')
      }
      out.commissionCapMonths = n
    }
  }
  if (out.freeSupremeActiveUsers < out.freeCommissionerActiveUsers) {
    throw new PartnerSettingsError(
      'freeSupremeActiveUsers',
      'The AF Supreme bar must be at or above the AF Commissioner bar',
    )
  }
  return out
}

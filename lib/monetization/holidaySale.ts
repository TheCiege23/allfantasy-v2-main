/**
 * The Black Friday → Cyber Monday 2026 sale: 50% off the first year of any paid plan, on the web.
 * Owner's decision, 2026-11-24. Pure (no server imports), so pages, the checkout builder and tests
 * all read the same rule.
 *
 * The window: Friday Nov 27 12:00 AM ET → Monday Nov 30 11:59 PM ET. It switches itself on and off;
 * nothing has to be deployed on Friday or Tuesday.
 *
 *   yearly plans  — 50% off the first year's payment (Stripe coupon, duration "once")
 *   monthly plans — 50% off each of the first 12 monthly payments (duration "repeating", 12 months)
 *
 * So "50% off your first year" is true of both, and it is the one sentence every surface says.
 *
 * ⚠ WEB ONLY. The iOS and Android apps sell through Apple and Google, whose prices this code cannot
 * change: every sale surface carries `data-hide-in-ios-app` and hides itself inside the Android app.
 * Google Play offers are refused by this app's Play checkout (lib/google-play/billingState.ts), so
 * do NOT add one in the Play Console for this sale — Android purchases would start failing.
 *
 * Env, all optional:
 *   NEXT_PUBLIC_HOLIDAY_SALE_DISABLED=1   kill switch — no banner, no discount
 *   NEXT_PUBLIC_HOLIDAY_SALE_STARTS_AT    ISO instant, to try the sale on staging before Friday
 *   NEXT_PUBLIC_HOLIDAY_SALE_ENDS_AT      ISO instant
 * NEXT_PUBLIC_ because the banner decides in the browser too. Setting any of them on Railway is a
 * redeploy (and a rebuild, which is what bakes them into the browser code).
 */

type Env = Record<string, string | undefined>

export const HOLIDAY_SALE_PERCENT_OFF = 50

/** Fri 2026-11-27 00:00 America/New_York (EST, UTC−5). */
export const HOLIDAY_SALE_DEFAULT_STARTS_AT = '2026-11-27T05:00:00.000Z'
/** Tue 2026-12-01 00:00 America/New_York — i.e. the end of Monday Nov 30, Eastern. */
export const HOLIDAY_SALE_DEFAULT_ENDS_AT = '2026-12-01T05:00:00.000Z'

export type HolidaySaleView = {
  /** ISO instant the sale started. */
  startsAt: string
  /** ISO instant the sale ends — what the countdown counts to. */
  endsAt: string
  percentOff: number
}

/**
 * The env the browser can see. `process.env.NEXT_PUBLIC_*` must be written out literally for Next to
 * inline it into client code, so this is not `process.env` passed through.
 */
function defaultEnv(): Env {
  return {
    NEXT_PUBLIC_HOLIDAY_SALE_DISABLED: process.env.NEXT_PUBLIC_HOLIDAY_SALE_DISABLED,
    NEXT_PUBLIC_HOLIDAY_SALE_STARTS_AT: process.env.NEXT_PUBLIC_HOLIDAY_SALE_STARTS_AT,
    NEXT_PUBLIC_HOLIDAY_SALE_ENDS_AT: process.env.NEXT_PUBLIC_HOLIDAY_SALE_ENDS_AT,
    VITEST: process.env.VITEST,
    HOLIDAY_SALE_IN_TESTS: process.env.HOLIDAY_SALE_IN_TESTS,
  }
}

function instant(raw: string | undefined, fallback: string): number {
  const t = Date.parse(raw?.trim() || '')
  return Number.isFinite(t) ? t : Date.parse(fallback)
}

/** The sale's window, whether or not it is running now. Null when switched off. */
export function holidaySaleWindow(env: Env = defaultEnv()): HolidaySaleView | null {
  const off = env.NEXT_PUBLIC_HOLIDAY_SALE_DISABLED?.trim().toLowerCase()
  if (off === '1' || off === 'true' || off === 'yes') return null
  const start = instant(env.NEXT_PUBLIC_HOLIDAY_SALE_STARTS_AT, HOLIDAY_SALE_DEFAULT_STARTS_AT)
  const end = instant(env.NEXT_PUBLIC_HOLIDAY_SALE_ENDS_AT, HOLIDAY_SALE_DEFAULT_ENDS_AT)
  if (!(end > start)) return null
  return {
    startsAt: new Date(start).toISOString(),
    endsAt: new Date(end).toISOString(),
    percentOff: HOLIDAY_SALE_PERCENT_OFF,
  }
}

/**
 * The sale, if it is running at `now`; otherwise null.
 *
 * ⚠ Off inside the unit-test runner unless a test asks for it (`HOLIDAY_SALE_IN_TESTS=1`, or an
 * explicit `env`). Otherwise every pricing and checkout test that runs on Nov 27–30 would see half
 * prices and a different coupon, and fail for four days for a reason unrelated to its own change.
 */
export function getHolidaySale(now: Date | number = Date.now(), env?: Env): HolidaySaleView | null {
  const e = env ?? defaultEnv()
  if (!env && e.VITEST && e.HOLIDAY_SALE_IN_TESTS !== '1') return null
  const window = holidaySaleWindow(e)
  if (!window) return null
  const t = typeof now === 'number' ? now : now.getTime()
  return t >= Date.parse(window.startsAt) && t < Date.parse(window.endsAt) ? window : null
}

/**
 * What the buyer pays, in cents, for a price of `cents` at 50% off.
 *
 * Rounded UP to the cent (half of $79.99 shows as $40.00, not $39.99): Stripe rounds the discount
 * itself, and a page must never show a lower price than the charge. Showing a cent more than Stripe
 * may charge is the safe direction.
 */
export function holidaySalePriceCents(cents: number, percentOff = HOLIDAY_SALE_PERCENT_OFF): number {
  if (!Number.isFinite(cents) || cents <= 0) return 0
  return Math.ceil((cents * (100 - percentOff)) / 100)
}

/** Same, in dollars, for surfaces that hold prices as dollars (the catalog's `amountUsd`). */
export function holidaySalePriceUsd(usd: number, percentOff = HOLIDAY_SALE_PERCENT_OFF): number {
  return holidaySalePriceCents(Math.round(usd * 100), percentOff) / 100
}

/**
 * The Stripe coupon a subscription on `interval` gets during the sale. Created on first use by the
 * checkout builder (ensureHolidaySaleCoupon), never by hand, and it stops being redeemable when the
 * sale ends (`redeem_by`), so a session opened at 11:58 PM Monday is the last one it can ride.
 */
export function holidaySaleCouponSpec(
  interval: 'month' | 'year',
  sale: HolidaySaleView,
): {
  id: string
  name: string
  percent_off: number
  duration: 'once' | 'repeating'
  duration_in_months?: number
  redeem_by: number
} {
  const redeemBy = Math.floor(Date.parse(sale.endsAt) / 1000)
  const base = `af_bf2026_${sale.percentOff}pct`
  return interval === 'year'
    ? {
        id: `${base}_yearly`,
        name: `Black Friday ${sale.percentOff}% off first year`,
        percent_off: sale.percentOff,
        duration: 'once',
        redeem_by: redeemBy,
      }
    : {
        id: `${base}_monthly12`,
        name: `Black Friday ${sale.percentOff}% off 12 months`,
        percent_off: sale.percentOff,
        duration: 'repeating',
        duration_in_months: 12,
        redeem_by: redeemBy,
      }
}

/** "Black Friday" until Saturday, then "Cyber Monday" — the name the banner leads with. */
export function holidaySaleName(now: Date | number = Date.now()): string {
  const t = typeof now === 'number' ? now : now.getTime()
  // Sun 2026-11-29 00:00 ET onward reads as the Cyber Monday leg.
  return t >= Date.parse('2026-11-29T05:00:00.000Z') ? 'Cyber Monday' : 'Black Friday'
}
